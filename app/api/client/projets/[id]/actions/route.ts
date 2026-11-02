import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { actionClientProjet, type ActionClientProjet } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — actions du Client sur son projet : manifester son
// intérêt, demander une précision ou un ajustement, accepter (proposition
// VÉRIFIÉE uniquement), décliner, abandonner.
const ACTIONS = new Set<ActionClientProjet>(["INTERET", "DEMANDE_PRECISION", "ACCEPTER", "DECLINER", "ABANDONNER"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const action = body?.action as ActionClientProjet;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) || null : null;
  const resultat = await actionClientProjet({
    clientId: session.clientId,
    email: session.email,
    projetId: params.id,
    action,
    propositionId: typeof body?.propositionId === "string" ? body.propositionId : null,
    message,
  });
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur, manquants: resultat.manquants }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
