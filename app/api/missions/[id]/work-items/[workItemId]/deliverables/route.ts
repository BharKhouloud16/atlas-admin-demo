import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { estIngenieurAutoriseSurWorkItem } from "@/lib/delivery-evidence/access";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// GET /api/missions/[id]/work-items/[workItemId]/deliverables — liste
// (lecture seule) des Deliverable liés à ce WorkItem via
// DeliverableWorkItemLink (A25). Aucune route existante ne permet cette
// lecture "par WorkItem" — seule la lecture "par Deliverable" existe
// (GET .../deliverables/[deliverableId]/work-items, strictement
// Admin-only même pour l'Ingénieur propriétaire, voir A25 test 49). Cette
// route ne gère AUCUNE mutation (création/suppression de lien reste
// exclusivement Admin via les routes A25 existantes, jamais dupliquée
// ici) — uniquement la lecture inverse nécessaire à l'écran WorkItem
// (Admin ET Ingénieur affecté), conformément au mandat DB-01 §22 ("si une
// API est réellement absente mais le service existe, créer la route
// minimale cohérente").
//
// RBAC : ADMIN toujours ; INGENIEUR uniquement si
// estIngenieurAutoriseSurWorkItem (même fonction que l'accès Evidence,
// A26) — même 404 IDOR-safe que le reste du repo en cas de WorkItem
// introuvable OU d'incohérence Mission OU d'Ingénieur non affecté (jamais
// une distinction qui révélerait l'existence de la ressource).
export async function GET(_req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  if (session.role !== "ADMIN" && session.role !== "INGENIEUR") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const workItem = await prisma.workItem.findUnique({ where: { id: params.workItemId }, select: { id: true, missionId: true } });
  if (!workItem || workItem.missionId !== params.id) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  if (session.role === "INGENIEUR") {
    const autorise = await estIngenieurAutoriseSurWorkItem(workItem.id, session.profilId);
    if (!autorise) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
    }
  }

  const liens = await prisma.deliverableWorkItemLink.findMany({
    where: { workItemId: workItem.id },
    select: {
      deliverable: {
        select: {
          id: true,
          acceptanceCriteria: true,
          versions: {
            select: { id: true, version: true, titre: true, natureContenu: true, statut: true, supersedesId: true, createdAt: true },
            orderBy: { version: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ workItemId: workItem.id, deliverables: liens.map((l) => l.deliverable) });
}
