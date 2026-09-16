import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { genererOuRecupererSolutions } from "@/lib/client-solution/generation";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — API Client.
//
// GET déclenche (ou récupère, si déjà à jour — voir genererOuRecupererSolutions,
// idempotent) la génération des options de solution pour un ClientNeed
// VALIDÉ. Même discipline d'isolation que le reste de l'Espace Client :
// clientId toujours dérivé de la session, jamais du corps/params ; un
// besoin d'un autre client renvoie 404 (même patron que
// /api/client/besoins/[id], jamais une fuite d'existence).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const resultat = await genererOuRecupererSolutions(params.id, session.clientId).catch((erreur: unknown) => {
    if (erreur instanceof Error && erreur.message === "BESOIN_INTROUVABLE") return null;
    throw erreur;
  });

  if (resultat === null) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  return NextResponse.json(resultat);
}
