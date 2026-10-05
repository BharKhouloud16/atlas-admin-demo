import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireWorkItemAssignment,
  executerTransitionWorkItemAssignmentAvecRetry,
  WorkItemAssignmentIntrouvableError,
  TransitionInvalideError,
  AssignmentDejaActifError,
  DateIncoherenteError,
  type ActionLifecycleWorkItemAssignment,
} from "@/lib/work-item/assignment";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A24 : WorkItemAssignment Foundation (05/10/2026).
//
// PATCH TOUJOURS une transition de lifecycle — même convention que
// app/api/missions/[id]/transition/route.ts (A22) : contrairement à
// MissionAssignment (A20, allocationPct/estResponsablePrincipal) ou
// WorkItem (A23, titre/description), WorkItemAssignment n'a AUCUN champ
// métier librement éditable après création (rôle/dates immuables, voir
// contrat A24 §27) — donc jamais de forme double "action présent/absent"
// ici, `action` est toujours requis. Réservé ADMIN — même périmètre que
// .../assignments (A20) et .../work-items (A23).
const ACTIONS_VALIDES: ActionLifecycleWorkItemAssignment[] = ["demarrer", "terminer", "annuler"];

async function workItemCoherent(missionId: string, workItemId: string): Promise<boolean> {
  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { id: true, missionId: true } });
  return !!workItem && workItem.missionId === missionId;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; workItemId: string; assignmentId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  if (!(await workItemCoherent(params.id, params.workItemId))) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  try {
    const assignment = await lireWorkItemAssignment({ assignmentId: params.assignmentId, workItemId: params.workItemId });
    return NextResponse.json(assignment);
  } catch (erreur) {
    if (erreur instanceof WorkItemAssignmentIntrouvableError) {
      return NextResponse.json({ error: "WorkItemAssignment introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; workItemId: string; assignmentId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/work-items/[workItemId]/assignments/[assignmentId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "WorkItemAssignment",
      ressourceId: params.assignmentId,
      detail: "Tentative de modification d'une WorkItemAssignment par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  if (!(await workItemCoherent(params.id, params.workItemId))) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.action !== "string" || !ACTIONS_VALIDES.includes(body.action as ActionLifecycleWorkItemAssignment)) {
    return NextResponse.json({ error: "action invalide (demarrer, terminer ou annuler attendu)." }, { status: 400 });
  }

  let dateFin: Date | null = null;
  if (body?.dateFin !== undefined && body.dateFin !== null) {
    if (typeof body.dateFin !== "string") {
      return NextResponse.json({ error: "dateFin doit être une chaîne ISO ou null." }, { status: 400 });
    }
    dateFin = new Date(body.dateFin);
    if (Number.isNaN(dateFin.getTime())) {
      return NextResponse.json({ error: "dateFin invalide." }, { status: 400 });
    }
  }

  try {
    const assignment = await executerTransitionWorkItemAssignmentAvecRetry({
      assignmentId: params.assignmentId,
      workItemId: params.workItemId,
      action: body.action as ActionLifecycleWorkItemAssignment,
      dateFin,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "workitem.assignment.transition",
      cible: `mission:${params.id}`,
      detail: `WorkItemAssignment ${assignment.id} (WorkItem ${params.workItemId}) -> ${assignment.statut} (action "${body.action}").`,
    });

    return NextResponse.json(assignment, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof WorkItemAssignmentIntrouvableError) {
      return NextResponse.json({ error: "WorkItemAssignment introuvable" }, { status: 404 });
    }
    if (erreur instanceof TransitionInvalideError) {
      return NextResponse.json(
        { error: `Transition impossible depuis le statut actuel (${erreur.depuis} -> ${erreur.vers}).` },
        { status: 409 }
      );
    }
    if (erreur instanceof AssignmentDejaActifError) {
      return NextResponse.json({ error: "Une autre WorkItemAssignment ACTIF existe déjà pour ce (WorkItem, MissionAssignment)." }, { status: 409 });
    }
    if (erreur instanceof DateIncoherenteError) {
      return NextResponse.json({ error: "dateFin doit être postérieure ou égale à dateDebut." }, { status: 400 });
    }
    throw erreur;
  }
}
