import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listerStepsRun, RunIntrouvableError } from "@/lib/agentic/runtime";

// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
// RBAC : ADMIN uniquement (voir app/api/agentic-runs/route.ts).
export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const steps = await listerStepsRun(params.runId);
    return NextResponse.json({ runId: params.runId, steps });
  } catch (erreur) {
    if (erreur instanceof RunIntrouvableError) {
      return NextResponse.json({ error: "AgenticRun introuvable." }, { status: 404 });
    }
    throw erreur;
  }
}
