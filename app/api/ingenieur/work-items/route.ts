import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// GET /api/ingenieur/work-items — l'Ingénieur a son propre endpoint filtré,
// même principe que /api/client/missions (voir app/api/missions/route.ts :
// "le client a son propre endpoint filtré"). Aucune route WorkItem
// existante (A23/A24) n'accepte INGENIEUR — elles restent strictement
// réservées ADMIN et verrouillées par tests dédiés (a23 test 52, a24 test
// 45 : "aucune route/rôle Agent distinct — tout non-Admin passe par la
// même vérification RBAC unique"). Cette route est donc ADDITIVE,
// séparée, et ne modifie ni ne contourne aucun contrôle existant.
//
// "Mes WorkItems" = tout WorkItem portant au moins une WorkItemAssignment
// dont la MissionAssignment référence le Talent courant (session.profilId)
// — exactement le chemin WorkItem -> WorkItemAssignment -> MissionAssignment
// -> Talent déjà documenté (A24), jamais un lien direct WorkItem.profilId
// (qui n'existe pas). Aucun filtre par statut d'assignment : "déjà affecté"
// suffit (même doctrine que lib/delivery-evidence/access.ts::
// estIngenieurAutoriseSurWorkItem).
//
// Pagination : même idiome que GET /api/missions (page/pageSize, défauts
// identiques) — seule liste de ce lot qui peut croître sans borne (across
// toutes les Missions d'un Ingénieur dans le temps), contrairement aux
// listes scopées à une seule Mission (WorkItem/Deliverable), volontairement
// non paginées comme l'API existante qu'elles réutilisent.
const PAGE_SIZE_DEFAUT = 20;
const PAGE_SIZE_MAX = 100;

function normaliserPagination(searchParams: URLSearchParams): { page: number; pageSize: number } {
  const pageBrut = Number(searchParams.get("page"));
  const page = Number.isInteger(pageBrut) && pageBrut >= 1 ? pageBrut : 1;
  const pageSizeBrut = Number(searchParams.get("pageSize"));
  const pageSize = Number.isInteger(pageSizeBrut) && pageSizeBrut >= 1 ? Math.min(pageSizeBrut, PAGE_SIZE_MAX) : PAGE_SIZE_DEFAUT;
  return { page, pageSize };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès réservé à l'ingénieur" }, { status: 403 });
  }

  const { page, pageSize } = normaliserPagination(req.nextUrl.searchParams);
  const where = {
    assignments: { some: { missionAssignment: { talentId: session.profilId } } },
  };

  const [total, workItems] = await Promise.all([
    prisma.workItem.count({ where }),
    prisma.workItem.findMany({
      where,
      select: {
        id: true,
        titre: true,
        statut: true,
        createdAt: true,
        mission: { select: { id: true, repere: true, client: { select: { nom: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    items: workItems,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
