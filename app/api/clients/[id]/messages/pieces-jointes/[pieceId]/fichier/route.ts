import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 3) — téléchargement
// Admin. [id] = Client.id (cohérence vérifiée), [pieceId] = PieceJointe.id.
// Réservé ADMIN. 404 (jamais 403 après le rôle) si le client n'existe pas,
// si la pièce n'existe pas, si elle appartient à un autre client que [id],
// ou si elle a été supprimée logiquement — même convention que le
// pendant Client.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; pieceId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id, pieceId } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }

  const piece = await prisma.pieceJointe.findUnique({
    where: { id: pieceId },
    select: { nomFichier: true, fileUrl: true, supprimeLe: true, message: { select: { clientId: true } } },
  });
  if (!piece || piece.message.clientId !== id || piece.supprimeLe) {
    return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });
  }

  let fichier: Awaited<ReturnType<typeof obtenirFichier>>;
  try {
    fichier = await obtenirFichier(piece.fileUrl);
  } catch {
    return NextResponse.json({ error: "Stockage indisponible." }, { status: 503 });
  }
  if (!fichier) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  return new NextResponse(fichier.stream, {
    headers: {
      "Content-Type": fichier.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `attachment; filename="${piece.nomFichier}"`,
    },
  });
}
