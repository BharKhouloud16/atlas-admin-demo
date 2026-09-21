import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";
import { marquerFilLu } from "@/lib/message-lecture";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 1 — Read State,
// 21/09/2026).
//
// Marque le fil de messagerie du Client comme lu jusqu'à maintenant.
// clientId dérivé EXCLUSIVEMENT de session.clientId (même discipline que
// /api/client/messages, /api/client/attentions) — jamais accepté depuis la
// requête. userId = User.id réel de CE Client (règle #6 : "Client = lecture
// propre au client").
//
// Déclenche la resynchronisation Attention (scopée, déjà existante) pour
// obtenir la résolution automatique de MESSAGE_NON_LU dès lecture effective
// (règle #11) — jamais une seconde synchronisation, le même chemin que GET
// /api/client/attentions.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const userId = await resoudreUserId(session.email);
  if (!userId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const curseur = await marquerFilLu(session.clientId, userId);
  await synchroniserAttentionsClient(session.clientId);

  return NextResponse.json({ dernierLuLe: curseur.dernierLuLe.toISOString() });
}
