import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { creerLienAvecRetry, listerLiensDeliverable, WorkItemIncoherentError, LienDejaExistantError } from "@/lib/deliverable/work-item-link";
import { DeliverableIntrouvableError } from "@/lib/deliverable/deliverable";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// Gestion des liens Deliverable <-> WorkItem réservée ADMIN UNIQUEMENT
// (contrat A25 §45 : "gérer les liens" figure dans la liste des pouvoirs
// Admin, absent de la liste Ingénieur — jamais un droit inventé au-delà
// de ce qui est explicitement accordé).
async function missionExiste(missionId: string): Promise<boolean> {
  return !!(await prisma.mission.findUnique({ where: { id: missionId }, select: { id: true } }));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; deliverableId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const deliverable = await prisma.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable || deliverable.missionId !== params.id) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  const liens = await listerLiensDeliverable(params.deliverableId);
  return NextResponse.json({ deliverableId: params.deliverableId, liens });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; deliverableId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/work-items",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Deliverable",
      ressourceId: params.deliverableId,
      detail: "Tentative de création d'un DeliverableWorkItemLink par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  if (!(await missionExiste(params.id))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }
  const deliverable = await prisma.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable || deliverable.missionId !== params.id) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.workItemId !== "string" || body.workItemId.trim().length === 0) {
    return NextResponse.json({ error: "workItemId requis." }, { status: 400 });
  }

  try {
    const lien = await creerLienAvecRetry({
      deliverableId: params.deliverableId,
      workItemId: body.workItemId,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "deliverable.workitem_link.created",
      cible: `mission:${params.id}`,
      detail: `DeliverableWorkItemLink ${lien.id} créé (Deliverable ${params.deliverableId}, WorkItem ${lien.workItemId}).`,
    });

    return NextResponse.json(lien, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof DeliverableIntrouvableError) {
      return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
    }
    if (erreur instanceof WorkItemIncoherentError) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
    }
    if (erreur instanceof LienDejaExistantError) {
      return NextResponse.json({ error: "Ce lien Deliverable/WorkItem existe déjà." }, { status: 409 });
    }
    throw erreur;
  }
}
