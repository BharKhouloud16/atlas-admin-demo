import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Réservé ADMIN — même principe que GET /api/talent/demandes (rôle ADMIN) :
// vue transverse tous clients confondus. Liste chaque ClientNeed (LOT 2/3)
// avec son état de liaison à une DemandeTalent (LOT 5, sourceNeedId) —
// jamais une copie des faits eux-mêmes (voir GET .../besoins/[id] pour le
// détail). Aucune donnée n'est filtrée par clientId ici : c'est la vue
// Admin volontairement transverse, comme /api/talent/demandes.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const besoins = await prisma.clientNeed.findMany({
    select: {
      id: true,
      titre: true,
      texteOriginal: true,
      statut: true,
      coherenceStatut: true,
      createdAt: true,
      client: { select: { nom: true } },
      demandeTalentCreee: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ besoins });
}
