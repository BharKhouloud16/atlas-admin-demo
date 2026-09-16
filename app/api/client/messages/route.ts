import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { validerContenuMessage } from "@/lib/client-messages";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Réservé CLIENT — même discipline que /api/client/besoins,
// /api/client/profil : clientId dérivé EXCLUSIVEMENT de session.clientId,
// jamais accepté depuis le corps de la requête. Le pendant Admin
// (GET/POST /api/clients/[id]/messages) écrit dans la même table Message,
// jamais une seconde source de vérité.

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { clientId: session.clientId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const contenu = validerContenuMessage(body?.contenu);
  if (!contenu) {
    return NextResponse.json({ error: "Contenu requis (1 à 2000 caractères)." }, { status: 400 });
  }

  const message = await prisma.message.create({
    data: { clientId: session.clientId, auteurRole: "CLIENT", contenu },
  });

  return NextResponse.json({ message }, { status: 201 });
}
