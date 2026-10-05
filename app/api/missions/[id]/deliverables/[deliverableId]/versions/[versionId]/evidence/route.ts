import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerEvidenceAvecRetry,
  listerEvidencesDeliverableVersion,
  CibleIncoherenteError,
  TargetIntrouvableError,
  MethodeConfianceInvalideError,
  ContenuInvalideError,
  EvidenceIntrouvableError,
  CibleDifferenteError,
  DejaSupersedeError,
} from "@/lib/delivery-evidence/evidence";
import { estIngenieurAutoriseSurMission } from "@/lib/delivery-evidence/access";
import type { DeliveryEvidenceMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A26 : DeliveryEvidence Foundation (05/10/2026).
//
// Même moteur central (lib/delivery-evidence/evidence.ts), même matrice
// méthode/rôle que .../work-items/[workItemId]/evidence (contrat A26
// §49/§50 : "le service central doit être partagé, ne pas créer deux
// implémentations métier différentes"). Seule différence : l'autorisation
// Ingénieur retombe sur Mission.profilId (pas de WorkItemAssignment
// équivalent pour un Deliverable dans ce lot — voir lib/delivery-evidence/
// access.ts::estIngenieurAutoriseSurMission).
//
// Une Evidence peut cibler N'IMPORTE QUELLE version (DRAFT/REVIEW/
// APPROVED/FINALIZED/REJECTED), y compris après finalisation (contrat
// A26 §26/§27) — jamais une précondition de statut DeliverableVersion.
const METHODES_VALIDES: DeliveryEvidenceMethod[] = [
  "DECLARATION_TALENT",
  "VALIDATION_ADMIN",
  "VALIDATION_CLIENT",
  "MESURE_SYSTEME",
  "TEST_AUTOMATISE",
  "INFERENCE_IA",
];
const METHODES_ADMIN_SEUL: DeliveryEvidenceMethod[] = ["VALIDATION_ADMIN", "INFERENCE_IA"];
const METHODES_INGENIEUR_AUTORISE: DeliveryEvidenceMethod[] = ["DECLARATION_TALENT", "MESURE_SYSTEME", "TEST_AUTOMATISE"];

async function versionCoherente(missionId: string, deliverableId: string, versionId: string): Promise<boolean> {
  const version = await prisma.deliverableVersion.findUnique({ where: { id: versionId }, select: { id: true, deliverableId: true } });
  if (!version || version.deliverableId !== deliverableId) return false;
  const deliverable = await prisma.deliverable.findUnique({ where: { id: deliverableId }, select: { missionId: true } });
  return !!deliverable && deliverable.missionId === missionId;
}

async function resoudreAcces(missionId: string, role: string, profilId: string | null, clientId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurMission(missionId, profilId);
  if (role === "CLIENT") {
    const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { clientId: true } });
    return !!mission && mission.clientId === clientId;
  }
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; deliverableId: string; versionId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await versionCoherente(params.id, params.deliverableId, params.versionId))) {
    return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
  }
  if (!(await resoudreAcces(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
  }

  const evidences = await listerEvidencesDeliverableVersion(params.versionId);
  return NextResponse.json({ deliverableVersionId: params.versionId, evidences });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; deliverableId: string; versionId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/versions/[versionId]/evidence",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "DeliverableVersion",
      ressourceId: params.versionId,
      detail: "Tentative de création d'une DeliveryEvidence par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await versionCoherente(params.id, params.deliverableId, params.versionId))) {
    return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
  }
  if (!(await resoudreAcces(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.methode !== "string" || !METHODES_VALIDES.includes(body.methode as DeliveryEvidenceMethod)) {
    return NextResponse.json(
      { error: "methode invalide (DECLARATION_TALENT, VALIDATION_ADMIN, VALIDATION_CLIENT, MESURE_SYSTEME, TEST_AUTOMATISE ou INFERENCE_IA attendu)." },
      { status: 400 }
    );
  }
  const methode = body.methode as DeliveryEvidenceMethod;

  if (session.role === "INGENIEUR" && !METHODES_INGENIEUR_AUTORISE.includes(methode)) {
    return NextResponse.json({ error: "Cette méthode n'est pas autorisée pour l'Ingénieur." }, { status: 403 });
  }
  if (session.role === "CLIENT" && methode !== "VALIDATION_CLIENT") {
    return NextResponse.json({ error: "Seule la méthode VALIDATION_CLIENT est autorisée pour le Client." }, { status: 403 });
  }
  if (session.role !== "ADMIN" && METHODES_ADMIN_SEUL.includes(methode)) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/versions/[versionId]/evidence",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "DeliverableVersion",
      ressourceId: params.versionId,
      detail: `Tentative de création d'une Evidence "${methode}" (réservée Admin) par un rôle non-Admin.`,
    });
    return NextResponse.json({ error: "Cette méthode est réservée à l'administrateur." }, { status: 403 });
  }

  if (typeof body?.contenu !== "string" || body.contenu.trim().length === 0) {
    return NextResponse.json({ error: "contenu requis (non vide)." }, { status: 400 });
  }

  try {
    const evidence = await creerEvidenceAvecRetry({
      deliverableVersionId: params.versionId,
      missionId: params.id,
      methode,
      confiance: body?.confiance,
      contenu: body.contenu,
      supersedesId: typeof body?.supersedesId === "string" ? body.supersedesId : null,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: evidence.supersedesId ? "delivery_evidence.superseded" : "delivery_evidence.created",
      cible: `mission:${params.id}`,
      detail: `DeliveryEvidence ${evidence.id} créée sur DeliverableVersion ${params.versionId} (méthode ${evidence.methode}, confiance ${evidence.confiance}).${
        evidence.supersedesId ? ` Supersède ${evidence.supersedesId}.` : ""
      }`,
    });

    return NextResponse.json(evidence, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof CibleIncoherenteError) {
      return NextResponse.json({ error: "Cible incohérente (exactement workItemId OU deliverableVersionId attendu)." }, { status: 409 });
    }
    if (erreur instanceof TargetIntrouvableError) {
      return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
    }
    if (erreur instanceof MethodeConfianceInvalideError) {
      return NextResponse.json({ error: "Combinaison méthode/confiance invalide." }, { status: 409 });
    }
    if (erreur instanceof ContenuInvalideError) {
      return NextResponse.json({ error: "contenu requis (non vide)." }, { status: 400 });
    }
    if (erreur instanceof EvidenceIntrouvableError) {
      return NextResponse.json({ error: "Evidence à superséder introuvable" }, { status: 404 });
    }
    if (erreur instanceof CibleDifferenteError) {
      return NextResponse.json({ error: "Une Evidence ne peut être supersédée que par une Evidence portant sur la même cible." }, { status: 409 });
    }
    if (erreur instanceof DejaSupersedeError) {
      return NextResponse.json({ error: "Cette Evidence est déjà supersédée." }, { status: 409 });
    }
    throw erreur;
  }
}
