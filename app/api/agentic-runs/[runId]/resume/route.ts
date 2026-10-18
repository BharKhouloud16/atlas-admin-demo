import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reprendreRun, RunIntrouvableError, TransitionInvalideError } from "@/lib/agentic/runtime";

// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
//
// RBAC : ADMIN uniquement (voir app/api/agentic-runs/route.ts).
//
// Ce point d'entrée est le SEUL endroit où WAITING_APPROVAL -> RUNNING
// est atteint (contrat A32 §7/§21) — il ne décide RIEN lui-même : il relit
// EN DIRECT l'AuthorizationRequest (B22) déjà résolue par ailleurs (via
// PATCH /api/control-plane/authorization-requests/[id]/approve, route
// existante, ADMIN-only, jamais modifiée par ce lot) et applique la
// transition qui en découle. Aucun agent ne peut structurellement
// atteindre ce résultat lui-même (aucune session agent n'existe) — jamais
// une auto-approbation (contrat A32 §21).
export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const run = await reprendreRun(params.runId);
    return NextResponse.json(run);
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
