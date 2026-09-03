import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Un client ne voit jamais que ses propres missions, et jamais de données
// tarifaires internes (TJM coût, marge) — seulement le suivi opérationnel.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const missions = await prisma.mission.findMany({
    where: { clientId: session.clientId },
    select: {
      id: true,
      repere: true,
      statut: true,
      nbJours: true,
      createdAt: true,
      profil: { select: { nom: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(missions);
}
