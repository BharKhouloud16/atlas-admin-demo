import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// lecture en masse Admin (pendant de app/api/client/attentions/tout-lire).
// Ne touche que les Attention recipientType=ADMIN — jamais les Attention
// Client (l'Admin les consulte mais n'en est jamais le destinataire réel).
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const maintenant = new Date();
  const resultat = await prisma.attention.updateMany({
    where: { recipientType: "ADMIN", statut: "OUVERTE" },
    data: { statut: "LUE", readAt: maintenant },
  });

  return NextResponse.json({ misesAJour: resultat.count });
}
