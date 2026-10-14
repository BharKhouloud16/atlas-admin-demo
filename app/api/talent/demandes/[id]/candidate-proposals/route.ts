import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { candidateProposalCreationSchema, premierMessageZod } from "@/lib/validation";
import {
  CandidateFinalDecisionEntreeIntrouvableError,
  DecisionSourceNonActiveError,
  EntreeNonRetenueError,
  PropositionActiveExistanteError,
  SupersedesInvalideError,
  creerCandidateProposalAvecRetry,
  listerCandidateProposalsDemandeTalent,
} from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §10.1/§10.2
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). ADMIN
// exclusif — même patron RBAC/tenant que
// app/api/talent/demandes/[id]/final-decision/route.ts.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const propositions = await listerCandidateProposalsDemandeTalent(params.id);
  return NextResponse.json({ demandeId: params.id, propositions });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = candidateProposalCreationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  // Défense supplémentaire : l'entrée référencée doit appartenir à CETTE
  // DemandeTalent (URL) — jamais une entrée d'une autre demande, même avec
  // un id valide ailleurs. 404 uniforme, jamais une distinction révélatrice.
  const entree = await prisma.candidateFinalDecisionEntree.findUnique({
    where: { id: analyse.data.candidateFinalDecisionEntreeId },
    include: { decision: { select: { demandeTalentId: true } } },
  });
  if (!entree || entree.decision.demandeTalentId !== params.id) {
    return NextResponse.json({ error: "Entrée de décision introuvable pour cette demande." }, { status: 404 });
  }

  try {
    const proposition = await creerCandidateProposalAvecRetry({
      candidateFinalDecisionEntreeId: analyse.data.candidateFinalDecisionEntreeId,
      supersedesId: analyse.data.supersedesId ?? null,
      createdByEmail: session.email,
    });

    // §6.1 étape 4 — aucun audit pour un BROUILLON (pas encore un fait
    // métier engageant, cohérent avec CTO Validation §16).
    return NextResponse.json(proposition, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof CandidateFinalDecisionEntreeIntrouvableError) {
      return NextResponse.json({ error: "Entrée de décision introuvable." }, { status: 404 });
    }
    if (erreur instanceof EntreeNonRetenueError) {
      return NextResponse.json({ error: "L'entrée référencée n'est pas RETENU." }, { status: 400 });
    }
    if (erreur instanceof DecisionSourceNonActiveError) {
      return NextResponse.json({ error: "La décision source n'est plus active." }, { status: 409 });
    }
    if (erreur instanceof SupersedesInvalideError) {
      return NextResponse.json({ error: "supersedesId invalide." }, { status: 409 });
    }
    if (erreur instanceof PropositionActiveExistanteError) {
      return NextResponse.json({ error: "Une proposition active existe déjà pour cette entrée." }, { status: 409 });
    }
    throw erreur;
  }
}
