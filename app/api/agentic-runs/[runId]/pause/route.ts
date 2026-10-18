import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { pauserRun, RunIntrouvableError, TransitionInvalideError } from "@/lib/agentic/runtime";

// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
// RBAC : ADMIN uniquement (voir app/api/agentic-runs/route.ts).
export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const run = await pauserRun(params.runId);
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
