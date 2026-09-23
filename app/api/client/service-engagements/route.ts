import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// PHASE 7 — Service OS Foundation. Liste Client de ses propres
// ServiceEngagement — même discipline d'isolation que
// GET /api/client/missions : filtre where:{clientId} en base, select
// explicite minimal, jamais de champ interne (rien n'existe ici de
// comparable à margeCible/tjmVente de toute façon — ServiceEngagement est
// billing-agnostic par conception, voir Decision Record Phase 6B).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const engagements = await prisma.serviceEngagement.findMany({
    where: { clientId: session.clientId },
    select: { id: true, titre: true, description: true, statut: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(engagements);
}
