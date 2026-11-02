import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { creerProjet, lireSaisieProjet, listerProjetsClient } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — projets complets du Client connecté (liste, création).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  return NextResponse.json({ projets: await listerProjetsClient(session.clientId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const resultat = await creerProjet(session.clientId, session.email, lireSaisieProjet(body));
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur, manquants: resultat.manquants }, { status: resultat.code });
  return NextResponse.json({ id: resultat.id }, { status: 201 });
}
