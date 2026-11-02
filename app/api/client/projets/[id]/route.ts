import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { completerProjet } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — le Client complète son projet avant toute proposition.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const resultat = await completerProjet(session.clientId, session.email, params.id, await req.json().catch(() => null));
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
