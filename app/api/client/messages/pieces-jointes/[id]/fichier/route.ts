import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 3) — téléchargement
// Client. [id] = PieceJointe.id. Ownership dérivée exclusivement via
// piece.message.clientId === session.clientId (jamais un clientId propre
// sur PieceJointe, voir prisma/schema.prisma). 404 (jamais 403) si la
// pièce n'existe pas, appartient à un autre client, ou a été supprimée
// logiquement (supprimeLe non null) — même convention que
// app/api/client/documents/[id]/fichier/route.ts et
// app/api/ingenieur/cv/fichier/route.ts : ne jamais confirmer l'existence
// d'une ressource qui n'est pas accessible.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const piece = await prisma.pieceJointe.findUnique({
    where: { id },
    select: { nomFichier: true, fileUrl: true, supprimeLe: true, message: { select: { clientId: true } } },
  });
  if (!piece || piece.message.clientId !== session.clientId || piece.supprimeLe) {
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
