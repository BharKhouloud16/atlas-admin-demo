import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerEvidenceAvecRetry,
  listerEvidencesWorkItem,
  CibleIncoherenteError,
  TargetIntrouvableError,
  MethodeConfianceInvalideError,
  ContenuInvalideError,
  EvidenceIntrouvableError,
  CibleDifferenteError,
  DejaSupersedeError,
} from "@/lib/delivery-evidence/evidence";
import { estIngenieurAutoriseSurWorkItem } from "@/lib/delivery-evidence/access";
import type { DeliveryEvidenceMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A26 : DeliveryEvidence Foundation (05/10/2026).
//
// RBAC (contrat A26 §31/§32/§35/§36, audité) : ADMIN sans restriction.
// INGENIEUR autorisé UNIQUEMENT sur un WorkItem auquel il est réellement
// affecté — via WorkItemAssignment -> MissionAssignment -> Talent (A24),
// jamais Mission.profilId (contrat A26 §33/§34). CLIENT autorisé en
// lecture et pour la méthode VALIDATION_CLIENT uniquement, sur sa PROPRE
// Mission. Aucun rôle Agent n'existe dans l'authentification réelle de ce
// repository (Role = ADMIN | INGENIEUR | CLIENT, voir prisma/schema.prisma)
// — INFERENCE_IA est donc créée par ADMIN, en attendant une véritable
// identité Agent dans un lot futur (même limitation documentée que
// app/api/missions/[id]/outcome/route.ts : "aucun appelant Agent n'existe
// dans ce lot, jamais par cette route directement").
//
// MATRICE méthode -> rôles autorisés (contrat A26 §31, verrouillée) :
// - DECLARATION_TALENT / MESURE_SYSTEME / TEST_AUTOMATISE : ADMIN, INGENIEUR (propriétaire).
// - VALIDATION_ADMIN : ADMIN uniquement (contrat A26 §35, jamais un autre rôle).
// - VALIDATION_CLIENT : ADMIN, CLIENT (propriétaire) (contrat A26 §36).
// - INFERENCE_IA : ADMIN uniquement (limitation documentée ci-dessus).
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

async function resoudreAcces(workItemId: string, missionId: string, role: string, profilId: string | null, clientId: string | null): Promise<boolean> {
  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { id: true, missionId: true } });
  if (!workItem || workItem.missionId !== missionId) return false;

  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurWorkItem(workItemId, profilId);
  if (role === "CLIENT") {
    const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { clientId: true } });
    return !!mission && mission.clientId === clientId;
  }
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await resoudreAcces(params.workItemId, params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const evidences = await listerEvidencesWorkItem(params.workItemId);
  return NextResponse.json({ workItemId: params.workItemId, evidences });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/work-items/[workItemId]/evidence",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "WorkItem",
      ressourceId: params.workItemId,
      detail: "Tentative de création d'une DeliveryEvidence par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await resoudreAcces(params.workItemId, params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
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
      contexteRoute: "/api/missions/[id]/work-items/[workItemId]/evidence",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "WorkItem",
      ressourceId: params.workItemId,
      detail: `Tentative de création d'une Evidence "${methode}" (réservée Admin) par un rôle non-Admin.`,
    });
    return NextResponse.json({ error: "Cette méthode est réservée à l'administrateur." }, { status: 403 });
  }

  if (typeof body?.contenu !== "string" || body.contenu.trim().length === 0) {
    return NextResponse.json({ error: "contenu requis (non vide)." }, { status: 400 });
  }

  try {
    const evidence = await creerEvidenceAvecRetry({
      workItemId: params.workItemId,
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
      detail: `DeliveryEvidence ${evidence.id} créée sur WorkItem ${params.workItemId} (méthode ${evidence.methode}, confiance ${evidence.confiance}).${
        evidence.supersedesId ? ` Supersède ${evidence.supersedesId}.` : ""
      }`,
    });

    return NextResponse.json(evidence, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof CibleIncoherenteError) {
      return NextResponse.json({ error: "Cible incohérente (exactement workItemId OU deliverableVersionId attendu)." }, { status: 409 });
    }
    if (erreur instanceof TargetIntrouvableError) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
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
