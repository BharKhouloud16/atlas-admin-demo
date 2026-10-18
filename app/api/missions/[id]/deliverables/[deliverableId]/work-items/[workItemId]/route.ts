import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { supprimerLien, LienIntrouvableError } from "@/lib/deliverable/work-item-link";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// DELETE retire UNIQUEMENT la ligne de jointure — jamais le WorkItem ni
// le Deliverable (contrat A25 §44). Réservé ADMIN, même périmètre que
// POST .../work-items.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; deliverableId: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/work-items/[workItemId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "DeliverableWorkItemLink",
      ressourceId: params.workItemId,
      detail: "Tentative de suppression d'un DeliverableWorkItemLink par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const deliverable = await prisma.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable || deliverable.missionId !== params.id) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  try {
    await supprimerLien({ deliverableId: params.deliverableId, workItemId: params.workItemId });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "deliverable.workitem_link.removed",
      cible: `mission:${params.id}`,
      detail: `DeliverableWorkItemLink retiré (Deliverable ${params.deliverableId}, WorkItem ${params.workItemId}).`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (erreur) {
    if (erreur instanceof LienIntrouvableError) {
      return NextResponse.json({ error: "Lien introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}
