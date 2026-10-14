import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireVersion,
  executerTransitionVersion,
  VersionIntrouvableError,
  TransitionInvalideError,
  type ActionLifecycleDeliverable,
} from "@/lib/deliverable/version";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// PATCH TOUJOURS une transition de lifecycle (action requise) — même
// convention que app/api/missions/[id]/work-items/[workItemId]/
// assignments/[assignmentId]/route.ts (A24) : DeliverableVersion n'a
// aucun champ métier librement éditable après création (contrat A25 §40 :
// titre/natureContenu/contenuStructure immuables, correction = nouvelle
// version).
//
// RBAC PAR ACTION (contrat A25 §19/§45, audité) : "soumettre" autorisé à
// ADMIN et INGENIEUR (sur sa propre Mission) ; "approuver"/"finaliser"/
// "rejeter" réservés à ADMIN UNIQUEMENT — en particulier FINALIZED exige
// explicitement Admin (contrat A25 §19 : "Un Talent/Engineer peut
// préparer et soumettre. Mais FINALIZED requiert Admin."). CLIENT : aucun
// accès (validation Client différée). Aucun rôle Agent.
const ACTIONS_VALIDES: ActionLifecycleDeliverable[] = ["soumettre", "approuver", "finaliser", "rejeter"];
const ACTIONS_ADMIN_SEUL: ActionLifecycleDeliverable[] = ["approuver", "finaliser", "rejeter"];

async function missionAutorisee(missionId: string, role: string, profilId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role !== "INGENIEUR") return false;
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { profilId: true } });
  return !!mission && mission.profilId === profilId;
}

async function deliverableCoherent(missionId: string, deliverableId: string): Promise<boolean> {
  const deliverable = await prisma.deliverable.findUnique({ where: { id: deliverableId }, select: { id: true, missionId: true } });
  return !!deliverable && deliverable.missionId === missionId;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; deliverableId: string; versionId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await missionAutorisee(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }
  if (!(await deliverableCoherent(params.id, params.deliverableId))) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  try {
    const version = await lireVersion({ versionId: params.versionId, deliverableId: params.deliverableId });
    return NextResponse.json(version);
  } catch (erreur) {
    if (erreur instanceof VersionIntrouvableError) {
      return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; deliverableId: string; versionId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/versions/[versionId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "DeliverableVersion",
      ressourceId: params.versionId,
      detail: "Tentative de transition d'une DeliverableVersion par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await missionAutorisee(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }
  if (!(await deliverableCoherent(params.id, params.deliverableId))) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.action !== "string" || !ACTIONS_VALIDES.includes(body.action as ActionLifecycleDeliverable)) {
    return NextResponse.json({ error: "action invalide (soumettre, approuver, finaliser ou rejeter attendu)." }, { status: 400 });
  }

  if (session.role === "INGENIEUR" && ACTIONS_ADMIN_SEUL.includes(body.action as ActionLifecycleDeliverable)) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/versions/[versionId]",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "DeliverableVersion",
      ressourceId: params.versionId,
      detail: `Tentative d'action "${body.action}" (réservée Admin) par un Ingénieur.`,
    });
    return NextResponse.json({ error: "Action réservée à l'administrateur (approuver, finaliser, rejeter)." }, { status: 403 });
  }

  try {
    const version = await executerTransitionVersion({
      versionId: params.versionId,
      deliverableId: params.deliverableId,
      action: body.action as ActionLifecycleDeliverable,
      raison: typeof body?.raison === "string" ? body.raison : undefined,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "deliverable.lifecycle.transition",
      cible: `mission:${params.id}`,
      detail: `DeliverableVersion ${version.id} -> ${version.statut} (action "${body.action}").${
        typeof body?.raison === "string" ? ` Raison : ${body.raison}.` : ""
      }`,
    });

    return NextResponse.json(version);
  } catch (erreur) {
    if (erreur instanceof VersionIntrouvableError) {
      return NextResponse.json({ error: "DeliverableVersion introuvable" }, { status: 404 });
    }
    if (erreur instanceof TransitionInvalideError) {
      return NextResponse.json(
        { error: `Transition impossible depuis le statut actuel (${erreur.depuis} -> ${erreur.vers}).` },
        { status: 409 }
      );
    }
    throw erreur;
  }
}
