import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { candidateProposalDecisionHorsSystemeSchema, premierMessageZod } from "@/lib/validation";
import {
  CandidateProposalIntrouvableError,
  ConflitTransitionError,
  DecisionSourceNonActiveError,
  decidreCandidateProposalAvecRetry,
} from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §6.3/§10.6
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). ADMIN
// enregistrant une réponse communiquée par le Client HORS SYSTÈME —
// `communiqueParClientHorsSysteme: true` et `canalHorsSysteme` renseigné
// sont OBLIGATOIRES (jamais une décision Admin autonome). Même discriminant
// Zod que app/api/talent/demandes/[id]/final-decision/route.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string; proposalId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const proposition = await prisma.candidateProposal.findUnique({ where: { id: params.proposalId }, select: { id: true, demandeTalentId: true } });
  if (!proposition || proposition.demandeTalentId !== params.id) {
    return NextResponse.json({ error: "Proposition introuvable pour cette demande." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = candidateProposalDecisionHorsSystemeSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    const { proposal, mutationReelle } = await decidreCandidateProposalAvecRetry({
      id: params.proposalId,
      decision: analyse.data.reponse,
      decideParEmail: session.email,
      communiqueParClientHorsSysteme: true,
      canalHorsSysteme: analyse.data.canalHorsSysteme,
    });

    if (mutationReelle) {
      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: analyse.data.reponse === "ACCEPTEE" ? "candidate.proposal.accepted" : "candidate.proposal.rejected",
        cible: `proposal:${proposal.id}`,
        detail: `Communiqué hors système (${analyse.data.canalHorsSysteme})`,
      });
    }

    return NextResponse.json(proposal, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof CandidateProposalIntrouvableError) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }
    if (erreur instanceof ConflitTransitionError) {
      return NextResponse.json({ error: "Cette proposition ne peut plus être décidée (expirée, déjà décidée, ou autre état)." }, { status: 409 });
    }
    if (erreur instanceof DecisionSourceNonActiveError) {
      return NextResponse.json({ error: "La décision source n'est plus active." }, { status: 409 });
    }
    throw erreur;
  }
}
