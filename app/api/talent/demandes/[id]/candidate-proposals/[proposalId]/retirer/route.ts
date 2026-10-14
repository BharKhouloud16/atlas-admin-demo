import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { CandidateProposalIntrouvableError, ConflitTransitionError, retirerCandidateProposalAvecRetry } from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §6.4/§10.7
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). ADMIN
// exclusif. Email Client au retrait : non implémenté, même limitation
// documentée que .../emettre/route.ts (aucune résolution fiable d'un
// email de contact Client dans ce dépôt — jamais une décision
// architecturale silencieuse).
export async function PATCH(_req: NextRequest, { params }: { params: { id: string; proposalId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const proposition = await prisma.candidateProposal.findUnique({ where: { id: params.proposalId }, select: { id: true, demandeTalentId: true } });
  if (!proposition || proposition.demandeTalentId !== params.id) {
    return NextResponse.json({ error: "Proposition introuvable pour cette demande." }, { status: 404 });
  }

  try {
    const { proposal, mutationReelle } = await retirerCandidateProposalAvecRetry({ id: params.proposalId });

    if (mutationReelle) {
      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "candidate.proposal.withdrawn",
        cible: `proposal:${proposal.id}`,
      });
    }

    return NextResponse.json(proposal, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof CandidateProposalIntrouvableError) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }
    if (erreur instanceof ConflitTransitionError) {
      return NextResponse.json({ error: "Cette proposition est déjà dans un état terminal (acceptée ou refusée)." }, { status: 409 });
    }
    throw erreur;
  }
}
