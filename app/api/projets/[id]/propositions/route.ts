import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { lireContenuProposition, publierProposition } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — l'Admin publie une proposition (nouvelle version) :
// INDICATIVE (hypothèses obligatoires, rien d'engageant) ou VÉRIFIÉE (équipe,
// délai et fourchette budgétaire confirmés).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/projets/[id]/propositions");
  }
  const resultat = await publierProposition(session.email, params.id, lireContenuProposition(await req.json().catch(() => null)));
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json({ id: resultat.id, version: resultat.version }, { status: 201 });
}
