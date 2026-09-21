import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 4) — suppression
// LOGIQUE Client. [id] = PieceJointe.id, ownership dérivée via
// piece.message.clientId (même discipline que le téléchargement, voir
// .../fichier/route.ts). Jamais un DELETE physique ni un appel à
// supprimerFichier() en V1 (mandat explicite) — seul supprimeLe est posé,
// ce qui suffit à rendre la pièce indisponible au téléchargement (voir
// .../fichier/route.ts, qui traite supprimeLe non-null comme "introuvable").
//
// Idempotence/concurrence : updateMany filtré sur supprimeLe: null fait de
// la mutation elle-même une opération atomique côté PostgreSQL — deux
// requêtes concurrentes ne peuvent jamais poser supprimeLe deux fois ni se
// marcher dessus ; un second appel après suppression renvoie le même 200
// sans ré-écrire la ligne.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const piece = await prisma.pieceJointe.findUnique({
    where: { id },
    select: { supprimeLe: true, message: { select: { clientId: true } } },
  });
  if (!piece || piece.message.clientId !== session.clientId) {
    return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });
  }

  await prisma.pieceJointe.updateMany({ where: { id, supprimeLe: null }, data: { supprimeLe: new Date() } });

  return NextResponse.json({ ok: true });
}
