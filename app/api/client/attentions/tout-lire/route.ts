import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// lecture en masse Client (mandat CEO V2.3 section 6 : "mark all as read").
//
// Scopé exclusivement à session.clientId — ne touche jamais que les lignes
// déjà OUVERTE de CE Client, jamais une opération globale.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const maintenant = new Date();
  const resultat = await prisma.attention.updateMany({
    where: { recipientType: "CLIENT", recipientId: session.clientId, statut: "OUVERTE" },
    data: { statut: "LUE", readAt: maintenant },
  });

  return NextResponse.json({ misesAJour: resultat.count });
}
