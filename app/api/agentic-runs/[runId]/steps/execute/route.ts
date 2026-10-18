import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { executerIteration, lireRun, RunIntrouvableError, TransitionInvalideError } from "@/lib/agentic/runtime";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// NOUVELLE route additive — ne modifie aucun fichier A32 existant. A32
// n'exposait qu'UN appel implicite à executerIteration() par Run (dans
// demarrerRun(), jamais rejoué ensuite) : la fondation ne nécessitait
// jamais une deuxième itération pilotée depuis l'API (contrat A32 §1,
// "pas encore une boucle métier autonome complète"). A34 EN A besoin : le
// Learning Loop requiert exactement 2 Steps (OBSERVE_ONLY puis
// PROPOSE_AND_ACT, contrat A34 §21) — cette route expose simplement
// l'appel direct à la fonction déjà publique executerIteration()
// (lib/agentic/runtime.ts, non modifiée, déjà exportée par A32) pour
// déclencher l'itération suivante d'un Run RUNNING. RBAC : ADMIN
// uniquement, même doctrine que les autres routes agentic-runs (voir
// app/api/agentic-runs/route.ts).
export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    await lireRun(params.runId); // IDOR/404 uniforme avant toute itération.
    const resultat = await executerIteration(params.runId);
    return NextResponse.json(resultat);
  } catch (erreur) {
    if (erreur instanceof RunIntrouvableError) {
      return NextResponse.json({ error: "AgenticRun introuvable." }, { status: 404 });
    }
    if (erreur instanceof TransitionInvalideError) {
      return NextResponse.json({ error: `Transition invalide : ${erreur.depuis} -> ${erreur.vers}.` }, { status: 409 });
    }
    throw erreur;
  }
}
