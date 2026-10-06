import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  // A34 — Learning Loop Runtime (06/10/2026). Précondition spécifique au
  // loop LEARNING (contrat A34 §4) : la Mission doit être TERMINEE avant
  // toute création de Run — non-existante -> 404, autre statut -> 400.
  // Gardée strictement ICI, jamais dans lib/agentic/runtime.ts::creerRun
  // (générique à tous les loopType, contrat A32 §30 : la RBAC/précondition
  // métier reste de la responsabilité de l'appelant, jamais du service).
  // Zéro impact sur FOUNDATION ou tout autre loopType.
  if (body?.loopType === "LEARNING") {
    if (typeof body?.missionId !== "string" || body.missionId.length === 0) {
      return NextResponse.json({ error: "missionId requis pour le loop LEARNING." }, { status: 400 });
    }
    const mission = await prisma.mission.findUnique({ where: { id: body.missionId }, select: { statut: true } });
    if (!mission) {
      return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
    }
    if (mission.statut !== "TERMINEE") {
      return NextResponse.json({ error: `Mission non TERMINEE (statut actuel : ${mission.statut}) — le loop LEARNING exige une Mission terminée.` }, { status: 400 });
    }
  }

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
