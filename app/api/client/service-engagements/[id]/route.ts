import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// PHASE 7 — Service OS Foundation. Détail Client d'un ServiceEngagement,
// incluant ses Documents (métadonnées seulement — jamais fileUrl, même
// discipline que GET /api/client/documents). Ownership revérifiée avant
// toute réponse — 404 (jamais 403) si le ServiceEngagement n'appartient
// pas au client courant, même convention anti-énumération que tout le
// reste du dépôt (voir app/api/client/besoins/[id]/route.ts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const engagement = await prisma.serviceEngagement.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      titre: true,
      description: true,
      statut: true,
      createdAt: true,
      updatedAt: true,
      documents: {
        select: { id: true, titre: true, type: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!engagement || engagement.clientId !== session.clientId) {
    return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }

  const { clientId: _clientId, ...reponse } = engagement;
  return NextResponse.json(reponse);
}
