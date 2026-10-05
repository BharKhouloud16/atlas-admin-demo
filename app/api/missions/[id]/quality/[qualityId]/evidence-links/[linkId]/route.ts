import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireQualityGate,
  supprimerLienEvidence,
  QualityGateIntrouvableError,
  QualityGateFinaliseeError,
  LienIntrouvableError,
} from "@/lib/delivery-quality/quality";
import { estIngenieurAutoriseSurMission } from "@/lib/delivery-evidence/access";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// Retrait d'un QualityEvidenceLink — hard delete, jamais un soft-SUPERSEDED
// (même discipline que DeliverableWorkItemLink, A25 §44) : ce lien ne
// porte lui-même aucun fait métier à historiser. Uniquement tant que la
// Quality parente est DRAFT (contrat A27 §17-20). RBAC identique à la
// création du lien : ADMIN (toute ligne) ou l'Ingénieur PRÉPARATEUR
// (créateur) de cette Quality précise, jamais le Client.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; qualityId: string; linkId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/quality/[qualityId]/evidence-links/[linkId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "QualityEvidenceLink",
      ressourceId: params.linkId,
      detail: "Tentative de retrait d'un QualityEvidenceLink par un rôle non autorisé (Client ou non authentifié).",
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

  try {
    await supprimerLienEvidence({ missionId: params.id, qualityGateId: params.qualityId, linkId: params.linkId });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "quality.evidence_link.removed",
      cible: `mission:${params.id}`,
      detail: `QualityEvidenceLink ${params.linkId} retiré de DeliveryQualityGate ${params.qualityId}.`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    if (erreur instanceof QualityGateFinaliseeError) {
      return NextResponse.json({ error: "Cette évaluation est déjà finalisée, ses liens Evidence sont immuables." }, { status: 409 });
    }
    if (erreur instanceof LienIntrouvableError) {
      return NextResponse.json({ error: "QualityEvidenceLink introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}
