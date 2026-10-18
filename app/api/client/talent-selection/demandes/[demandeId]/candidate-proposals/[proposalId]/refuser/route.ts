import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import {
  CandidateProposalIntrouvableError,
  ConflitTransitionError,
  DecisionSourceNonActiveError,
  decidreCandidateProposalAvecRetry,
} from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §6.3/§10.5
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). Symétrique de
// .../accepter — voir ce fichier pour le détail des gardes.
export async function POST(_req: NextRequest, { params }: { params: { demandeId: string; proposalId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const proposition = await prisma.candidateProposal.findUnique({
    where: { id: params.proposalId },
    select: { id: true, demandeTalentId: true, clientId: true },
  });
  if (!proposition || proposition.demandeTalentId !== params.demandeId || proposition.clientId !== session.clientId) {
    return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
  }

  try {
    const { proposal, mutationReelle } = await decidreCandidateProposalAvecRetry({
      id: params.proposalId,
      decision: "REFUSEE",
      decideParEmail: session.email,
    });

    if (mutationReelle) {
      await journaliser({
        acteurEmail: session.email,
        acteurRole: "CLIENT",
        action: "candidate.proposal.rejected",
        cible: `proposal:${proposal.id}`,
      });
    }

    return NextResponse.json(proposal, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof CandidateProposalIntrouvableError) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }
    if (erreur instanceof ConflitTransitionError) {
      return NextResponse.json({ error: "Cette proposition ne peut plus être refusée (expirée, déjà décidée, ou autre état)." }, { status: 409 });
    }
    if (erreur instanceof DecisionSourceNonActiveError) {
      return NextResponse.json({ error: "La décision source n'est plus active." }, { status: 409 });
    }
    throw erreur;
  }
}
