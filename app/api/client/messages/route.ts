import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { validerContenuMessage } from "@/lib/client-messages";
import { resoudreUserId } from "@/lib/session-user";
import { compterMessagesNonLus } from "@/lib/message-lecture";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";

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

  // V2.4 — Pièces jointes (Lot 1/2) : métadonnées uniquement, jamais
  // fileUrl (voir lib/storage.ts), jamais les pièces supprimées
  // logiquement (supprimeLe non null).
  const messages = await prisma.message.findMany({
    where: { clientId: session.clientId },
    orderBy: { createdAt: "asc" },
    include: {
      pieceJointes: {
        where: { supprimeLe: null },
        select: { id: true, nomFichier: true, mimeType: true, tailleOctets: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // V2.5 — Communication Intelligence (Lot 1, 21/09/2026) : nonLus = messages
  // ADMIN postérieurs au curseur de lecture de CE Client (userId réel,
  // jamais un sentinel de rôle — voir lib/message-lecture.ts).
  const userId = await resoudreUserId(session.email);
  const nonLus = userId ? await compterMessagesNonLus(session.clientId, userId, "ADMIN") : 0;

  return NextResponse.json({ messages, nonLus });
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

  // V2.5 — Communication Intelligence (Lot 2, 21/09/2026) : déclenche la
  // resynchronisation Attention scopée dès l'envoi (jamais une nouvelle
  // synchronisation — voir lib/attention/synchronisation.ts,
  // construireEntitesMessage) pour que MESSAGE_NON_LU apparaisse côté Admin
  // sans attendre son prochain chargement de liste.
  await synchroniserAttentionsClient(session.clientId);

  return NextResponse.json({ message }, { status: 201 });
}
