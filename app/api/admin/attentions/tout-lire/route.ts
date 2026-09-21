import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// lecture en masse Admin (pendant de app/api/client/attentions/tout-lire).
// Ne touche que les Attention recipientType=ADMIN — jamais les Attention
// Client (l'Admin les consulte mais n'en est jamais le destinataire réel).
//
// V2.5 (21/09/2026) : recipientId non-null = Attention individuelle
// (règle #7, ex. MESSAGE_NON_LU) — ne touche jamais le curseur d'un autre
// Admin. recipientId=null reste partagé (ex. ANOMALIE_FINANCIERE), marqué
// lu par n'importe quel Admin comme avant V2.5.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const userId = await resoudreUserId(session.email);
  const maintenant = new Date();
  const resultat = await prisma.attention.updateMany({
    where: { recipientType: "ADMIN", statut: "OUVERTE", OR: [{ recipientId: null }, { recipientId: userId }] },
    data: { statut: "LUE", readAt: maintenant },
  });

  return NextResponse.json({ misesAJour: resultat.count });
}
