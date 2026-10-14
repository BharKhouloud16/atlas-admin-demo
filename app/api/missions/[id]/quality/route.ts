import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerQualityGate,
  listerQualityGatesMission,
  listerQualityGatesDeliverableVersion,
  DeliverableVersionIntrouvableError,
  CriteresInvalidesError,
  ResultatInvalideError,
} from "@/lib/delivery-quality/quality";
import { estIngenieurAutoriseSurMission, estClientAutoriseSurMission } from "@/lib/delivery-evidence/access";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// Route de niveau MISSION (contrat A27 §43, suggestion mandat) — jamais
// nichée sous deliverables/versions comme DeliveryEvidence (A26) : la
// cible de Quality est TOUJOURS exactement une DeliverableVersion (contrat
// A27 §6/§7, décision Option A — voir prisma/schema.prisma), jamais une
// ambiguïté de nesting à résoudre par l'URL. deliverableVersionId est
// fourni dans le corps de la requête, résolu et vérifié par le service
// (contrat A27 §8/§9).
//
// RBAC (contrat A27 §17-21, audité) : ADMIN et INGENIEUR (sur sa propre
// Mission, via lib/delivery-evidence/access.ts::estIngenieurAutoriseSurMission,
// même fonction partagée que A26 pour la branche DeliverableVersion)
// peuvent créer/préparer une DRAFT. CLIENT : lecture uniquement sur ses
// propres Mission — ne devient JAMAIS automatiquement approbateur Quality
// (contrat A27 §21, sa validation reste exclusivement
// DeliveryEvidence.VALIDATION_CLIENT, A26). Aucun rôle Agent (contrat
// A27 §22-27, limitation déjà documentée par A26/A6.1).
async function resoudreAcces(missionId: string, role: string, profilId: string | null, clientId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurMission(missionId, profilId);
  if (role === "CLIENT") return estClientAutoriseSurMission(missionId, clientId);
  return false;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  if (!(await resoudreAcces(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const deliverableVersionId = req.nextUrl.searchParams.get("deliverableVersionId");
  const qualityGates = deliverableVersionId
    ? await listerQualityGatesDeliverableVersion(deliverableVersionId)
    : await listerQualityGatesMission(params.id);

  return NextResponse.json({ missionId: params.id, qualityGates });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/quality",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'une DeliveryQualityGate par un rôle non authentifié.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  if (session.role === "CLIENT") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/quality",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Le Client ne peut jamais créer/préparer une DeliveryQualityGate (contrat A27 §21).",
    });
    return NextResponse.json({ error: "Le Client ne peut pas créer une évaluation de qualité." }, { status: 403 });
  }
  if (!(await resoudreAcces(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.deliverableVersionId !== "string" || !body.deliverableVersionId) {
    return NextResponse.json({ error: "deliverableVersionId requis." }, { status: 400 });
  }
  if (typeof body?.criteresEvalues !== "string" || body.criteresEvalues.trim().length === 0) {
    return NextResponse.json({ error: "criteresEvalues requis (non vide)." }, { status: 400 });
  }

  try {
    const qualityGate = await creerQualityGate({
      missionId: params.id,
      deliverableVersionId: body.deliverableVersionId,
      criteresEvalues: body.criteresEvalues,
      resultat: body?.resultat,
      evaluatedByEmail: session.email,
      evaluatedByRole: session.role,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "quality.created",
      cible: `mission:${params.id}`,
      detail: `DeliveryQualityGate ${qualityGate.id} créée sur DeliverableVersion ${qualityGate.deliverableVersionId} (résultat ${qualityGate.resultat}).`,
    });

    return NextResponse.json(qualityGate, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof DeliverableVersionIntrouvableError) {
      return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
    }
    if (erreur instanceof CriteresInvalidesError) {
      return NextResponse.json({ error: "criteresEvalues requis (non vide)." }, { status: 400 });
    }
    if (erreur instanceof ResultatInvalideError) {
      return NextResponse.json({ error: "resultat invalide (PASS, FAIL ou NOT_DETERMINABLE attendu)." }, { status: 400 });
    }
    throw erreur;
  }
}
