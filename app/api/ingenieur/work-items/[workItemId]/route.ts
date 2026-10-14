import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { estIngenieurAutoriseSurWorkItem } from "@/lib/delivery-evidence/access";
import { listerEvidencesWorkItem } from "@/lib/delivery-evidence/evidence";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// GET /api/ingenieur/work-items/[workItemId] — détail, réservé à
// l'Ingénieur réellement affecté. Autorisation : EXACTEMENT
// estIngenieurAutoriseSurWorkItem (lib/delivery-evidence/access.ts), déjà
// construite pour ce besoin précis et déjà utilisée par la route Evidence
// (A26) — aucun nouveau mécanisme d'autorisation. 404 "WorkItem
// introuvable" si l'Ingénieur n'est pas affecté (jamais 403, même
// discipline IDOR que le reste du repo : un non-affecté ne doit jamais
// savoir si le WorkItem existe).
//
// Ne modifie, ne duplique, ni ne contourne aucune route ADMIN existante
// (app/api/missions/[id]/work-items/[workItemId]/route.ts reste intact et
// strictement Admin-only). Lecture seule : aucune mutation ici.
export async function GET(_req: NextRequest, { params }: { params: { workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès réservé à l'ingénieur" }, { status: 403 });
  }

  const autorise = await estIngenieurAutoriseSurWorkItem(params.workItemId, session.profilId);
  if (!autorise) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.workItemId },
    select: {
      id: true,
      titre: true,
      description: true,
      statut: true,
      createdAt: true,
      mission: { select: { id: true, repere: true, client: { select: { nom: true } } } },
      // Uniquement MES WorkItemAssignment (jamais celles d'un autre
      // Talent sur ce même WorkItem — contrat §7 "il ne doit jamais
      // pouvoir consulter un WorkItem arbitraire", étendu par prudence à
      // "ni les affectations d'un autre Talent sur SON propre WorkItem").
      assignments: {
        where: { missionAssignment: { talentId: session.profilId } },
        select: { id: true, role: true, statut: true, dateDebut: true, dateFin: true, missionAssignment: { select: { id: true, role: true } } },
        orderBy: { createdAt: "desc" },
      },
      deliverableLinks: {
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
      },
    },
  });

  if (!workItem) {
    return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
  }

  const evidences = await listerEvidencesWorkItem(workItem.id);

  return NextResponse.json({
    workItem: { id: workItem.id, titre: workItem.titre, description: workItem.description, statut: workItem.statut, createdAt: workItem.createdAt },
    mission: workItem.mission,
    monAssignment: workItem.assignments,
    deliverables: workItem.deliverableLinks.map((l) => l.deliverable),
    evidences,
  });
}
