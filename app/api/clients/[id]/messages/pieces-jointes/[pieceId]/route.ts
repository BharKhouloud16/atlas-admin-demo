import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 4) — suppression
// LOGIQUE Admin. Même discipline que le pendant Client (jamais un DELETE
// physique, updateMany filtré sur supprimeLe: null pour l'idempotence/
// concurrence).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; pieceId: string }> }) {
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
    select: { supprimeLe: true, message: { select: { clientId: true } } },
  });
  if (!piece || piece.message.clientId !== id) {
    return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });
  }

  await prisma.pieceJointe.updateMany({ where: { id: pieceId, supprimeLe: null }, data: { supprimeLe: new Date() } });

  return NextResponse.json({ ok: true });
}
