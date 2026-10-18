import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerWorkItemAssignmentAvecRetry,
  listerAssignmentsWorkItem,
  MissionAssignmentIntrouvableError,
} from "@/lib/work-item/assignment";
import { WorkItemIntrouvableError, WorkItemTerminalError, MissionFermeeError } from "@/lib/work-item/lifecycle";
import type { WorkItemAssignmentRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A24 : WorkItemAssignment Foundation (05/10/2026).
//
// Réservé ADMIN — même périmètre que .../assignments (A20) et
// .../work-items (A23) : le client NE fournit JAMAIS talentId/profilId
// (contrat A24 §2/§10), uniquement missionAssignmentId. Le serveur résout
// le Talent en lisant MissionAssignment — jamais l'inverse.
const ROLES_VALIDES: WorkItemAssignmentRole[] = ["EXECUTEUR", "CONTRIBUTEUR", "REVIEWER"];

export async function GET(_req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const workItem = await prisma.workItem.findUnique({ where: { id: params.workItemId }, select: { id: true, missionId: true } });
  if (!workItem || workItem.missionId !== params.id) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const assignments = await listerAssignmentsWorkItem(params.workItemId);
  return NextResponse.json({ workItemId: params.workItemId, assignments });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/work-items/[workItemId]/assignments",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "WorkItem",
      ressourceId: params.workItemId,
      detail: "Tentative de création d'une WorkItemAssignment par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  // IDOR — même convention que GET ci-dessus : un WorkItem n'appartenant
  // pas à la Mission de l'URL est traité comme introuvable, jamais une
  // fuite d'existence distincte.
  const workItemCoherent = await prisma.workItem.findUnique({ where: { id: params.workItemId }, select: { id: true, missionId: true } });
  if (!workItemCoherent || workItemCoherent.missionId !== params.id) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.missionAssignmentId !== "string" || body.missionAssignmentId.trim().length === 0) {
    return NextResponse.json({ error: "missionAssignmentId requis." }, { status: 400 });
  }
  if (typeof body?.role !== "string" || !ROLES_VALIDES.includes(body.role as WorkItemAssignmentRole)) {
    return NextResponse.json({ error: "role invalide (EXECUTEUR, CONTRIBUTEUR ou REVIEWER)." }, { status: 400 });
  }
  let dateDebut: Date | null = null;
  if (body?.dateDebut !== undefined && body.dateDebut !== null) {
    if (typeof body.dateDebut !== "string") {
      return NextResponse.json({ error: "dateDebut doit être une chaîne ISO ou null." }, { status: 400 });
    }
    dateDebut = new Date(body.dateDebut);
    if (Number.isNaN(dateDebut.getTime())) {
      return NextResponse.json({ error: "dateDebut invalide." }, { status: 400 });
    }
  }

  try {
    const assignment = await creerWorkItemAssignmentAvecRetry({
      workItemId: params.workItemId,
      missionAssignmentId: body.missionAssignmentId,
      role: body.role as WorkItemAssignmentRole,
      dateDebut,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "workitem.assignment.created",
      cible: `mission:${params.id}`,
      detail: `WorkItemAssignment ${assignment.id} créée (WorkItem ${params.workItemId}, MissionAssignment ${assignment.missionAssignmentId}, rôle ${assignment.role}).`,
    });

    return NextResponse.json(assignment, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof WorkItemIntrouvableError) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
    }
    if (erreur instanceof MissionFermeeError) {
      return NextResponse.json({ error: "Impossible de créer une WorkItemAssignment sur une Mission TERMINEE ou ANNULEE." }, { status: 409 });
    }
    if (erreur instanceof WorkItemTerminalError) {
      return NextResponse.json({ error: "Ce WorkItem est dans un état terminal (TERMINE/ANNULE), aucune nouvelle affectation." }, { status: 409 });
    }
    if (erreur instanceof MissionAssignmentIntrouvableError) {
      return NextResponse.json({ error: "MissionAssignment introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}
