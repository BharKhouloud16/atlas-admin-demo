import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireQualityGate,
  creerLienEvidence,
  listerLiensEvidence,
  QualityGateIntrouvableError,
  QualityGateFinaliseeError,
  DeliveryEvidenceIntrouvableError,
  LienDejaExistantError,
} from "@/lib/delivery-quality/quality";
import { estIngenieurAutoriseSurMission, estClientAutoriseSurMission } from "@/lib/delivery-evidence/access";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// QualityEvidenceLink — provenance Evidence d'une Quality, jamais une
// copie de contenu (contrat A27 §14/§15/§16/§33-36). Ajout UNIQUEMENT
// tant que la Quality parente est DRAFT (contrat A27 §17-20, même
// doctrine que le contenu lui-même — voir .../quality/[qualityId]/
// route.ts). RBAC identique à l'édition de contenu : ADMIN (toute ligne)
// ou l'Ingénieur PRÉPARATEUR (créateur) de cette Quality précise, jamais
// le Client (contrat A27 §21).
async function resoudreAccesLecture(missionId: string, role: string, profilId: string | null, clientId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurMission(missionId, profilId);
  if (role === "CLIENT") return estClientAutoriseSurMission(missionId, clientId);
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; qualityId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await resoudreAccesLecture(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  try {
    const liens = await listerLiensEvidence(params.id, params.qualityId);
    return NextResponse.json({ qualityGateId: params.qualityId, evidenceLinks: liens });
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string; qualityId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/quality/[qualityId]/evidence-links",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "DeliveryQualityGate",
      ressourceId: params.qualityId,
      detail: "Tentative de création d'un QualityEvidenceLink par un rôle non autorisé (Client ou non authentifié).",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (session.role === "INGENIEUR" && !(await estIngenieurAutoriseSurMission(params.id, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  let gate;
  try {
    gate = await lireQualityGate(params.id, params.qualityId);
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    throw erreur;
  }
  if (session.role === "INGENIEUR" && gate.createdByEmail !== session.email) {
    return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.deliveryEvidenceId !== "string" || !body.deliveryEvidenceId) {
    return NextResponse.json({ error: "deliveryEvidenceId requis." }, { status: 400 });
  }

  try {
    const lien = await creerLienEvidence({
      missionId: params.id,
      qualityGateId: params.qualityId,
      deliveryEvidenceId: body.deliveryEvidenceId,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "quality.evidence_link.created",
      cible: `mission:${params.id}`,
      detail: `QualityEvidenceLink ${lien.id} créé entre DeliveryQualityGate ${params.qualityId} et DeliveryEvidence ${body.deliveryEvidenceId}.`,
    });

    return NextResponse.json(lien, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    if (erreur instanceof QualityGateFinaliseeError) {
      return NextResponse.json({ error: "Cette évaluation est déjà finalisée, ses liens Evidence sont immuables." }, { status: 409 });
    }
    if (erreur instanceof DeliveryEvidenceIntrouvableError) {
      return NextResponse.json({ error: "DeliveryEvidence introuvable" }, { status: 404 });
    }
    if (erreur instanceof LienDejaExistantError) {
      return NextResponse.json({ error: "Ce lien existe déjà entre cette DeliveryQualityGate et cette DeliveryEvidence." }, { status: 409 });
    }
    throw erreur;
  }
}
