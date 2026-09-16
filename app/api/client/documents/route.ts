import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  // CLIENT COMPLETION PROGRAM — C6 (16/09/2026) : fileUrl n'est plus
  // jamais renvoyé tel quel (URL de stockage privée, voir le commentaire
  // de lib/storage.ts) — le téléchargement passe désormais par
  // GET /api/client/documents/[id]/fichier, qui revérifie l'ownership.
  const documents = await prisma.document.findMany({
    where: { clientId: session.clientId },
    select: { id: true, titre: true, type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(documents);
}
