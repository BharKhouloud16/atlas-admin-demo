import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  creerRun,
  AgentIdentityIntrouvableError,
  AgentIdentityDesactiveeError,
  LoopInvalideError,
  ActionOuScopeInvalideError,
  GoalManquantError,
  MaxIterationsInvalideError,
  MissionIntrouvableError,
  ContexteIncoherentError,
} from "@/lib/agentic/runtime";

// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
//
// RBAC (contrat A32 §28, décision documentée dans le rapport final) :
// ADMIN UNIQUEMENT. Le contrat A31 n'accorde explicitement à l'INGENIEUR
// que le droit de PROPOSER un contenu (Learning, A30) sur sa propre
// Mission — jamais celui de créer/piloter un AgenticRun, qui peut déclarer
// n'importe quelle action/scope (potentiellement WRITE/EXECUTE). Faute
// d'un besoin métier démontré et d'un octroi explicite du contrat A31/A32
// pour l'INGENIEUR, ce lot retient par défaut un refus (même discipline
// que le choix CLIENT sur Learning, A30 §11/§18) — à reconfirmer
// explicitement avant tout élargissement futur. CLIENT n'a jamais accès
// (contrat A32 §28, "ne donne pas automatiquement à CLIENT l'accès").
// Aucun rôle Agent (structurellement impossible : aucune session agent
// n'existe, B19/B20).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  try {
    const run = await creerRun({
      loopType: body?.loopType,
      loopVersion: body?.loopVersion,
      agentIdentityId: body?.agentIdentityId,
      declaredAction: body?.declaredAction,
      declaredScope: body?.declaredScope,
      goal: body?.goal,
      missionId: typeof body?.missionId === "string" ? body.missionId : null,
      needVersionId: typeof body?.needVersionId === "string" ? body.needVersionId : null,
      solutionDecisionId: typeof body?.solutionDecisionId === "string" ? body.solutionDecisionId : null,
      maxIterations: body?.maxIterations,
      createdByEmail: session.email,
      createdByRole: session.role,
    });
    return NextResponse.json(run, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof AgentIdentityIntrouvableError) {
      return NextResponse.json({ error: "AgentIdentity introuvable." }, { status: 404 });
    }
    if (erreur instanceof AgentIdentityDesactiveeError) {
      return NextResponse.json({ error: "AgentIdentity désactivée (DISABLED)." }, { status: 400 });
    }
    if (erreur instanceof LoopInvalideError) {
      return NextResponse.json({ error: "loopType/loopVersion invalide (registre fermé)." }, { status: 400 });
    }
    if (erreur instanceof ActionOuScopeInvalideError) {
      return NextResponse.json({ error: "declaredAction/declaredScope invalide." }, { status: 400 });
    }
    if (erreur instanceof GoalManquantError) {
      return NextResponse.json({ error: "goal requis (texte non vide)." }, { status: 400 });
    }
    if (erreur instanceof MaxIterationsInvalideError) {
      return NextResponse.json({ error: "maxIterations invalide (entier strictement positif, plafonné)." }, { status: 400 });
    }
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
    }
    if (erreur instanceof ContexteIncoherentError) {
      return NextResponse.json({ error: `Contexte incohérent : ${erreur.detail}` }, { status: 400 });
    }
    throw erreur;
  }
}
