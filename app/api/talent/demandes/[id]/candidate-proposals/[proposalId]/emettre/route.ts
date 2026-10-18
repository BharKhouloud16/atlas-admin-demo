import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { candidateProposalEmissionSchema, premierMessageZod } from "@/lib/validation";
import {
  CandidateProposalIntrouvableError,
  DecisionSourceNonActiveError,
  SnapshotIncompletError,
  TransitionInvalideError,
  emettreCandidateProposalAvecRetry,
} from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §6.2/§10.4
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). ADMIN
// exclusif. Snapshot commercial fourni ici (aucune route d'édition séparée
// dans le périmètre contractuel des 8 routes, §10) — complété et figé au
// moment même de l'émission.
//
// Email Client à l'émission : non implémenté dans ce lot — le Design
// Contract (§12) le classe [RECOMMANDATION], jamais LOCKED, et aucun
// précédent fiable de résolution d'un email de contact Client (vs
// Client.email nullable ou Client.compte.email) n'existe dans ce dépôt ;
// fabriquer cette résolution serait une décision architecturale
// silencieuse. L'audit via journaliser() (invariant 12, obligatoire) reste
// intégralement implémenté ci-dessous.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; proposalId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const proposition = await prisma.candidateProposal.findUnique({ where: { id: params.proposalId }, select: { id: true, demandeTalentId: true, candidateFinalDecisionEntreeId: true } });
  if (!proposition || proposition.demandeTalentId !== params.id) {
    return NextResponse.json({ error: "Proposition introuvable pour cette demande." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = candidateProposalEmissionSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    const { proposal, mutationReelle } = await emettreCandidateProposalAvecRetry({
      id: params.proposalId,
      emisParEmail: session.email,
      snapshot: {
        tjmPropose: analyse.data.tjmPropose,
        devise: analyse.data.devise,
        dureeJours: analyse.data.dureeJours,
        dateDebutEnvisagee: analyse.data.dateDebutEnvisagee ?? null,
        dateValidite: analyse.data.dateValidite ?? null,
      },
    });

    // Étape 4, uniquement pour la branche gagnante (corrigé A35.4/F2) —
    // jamais une seconde journalisation pour une transition déjà réalisée.
    if (mutationReelle) {
      await journaliser({
        acteurEmail: proposal.emisParEmail ?? session.email,
        acteurRole: "ADMIN",
        action: "candidate.proposal.emitted",
        cible: `proposal:${proposal.id} entree:${proposition.candidateFinalDecisionEntreeId}`,
      });
    }

    return NextResponse.json(proposal, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof CandidateProposalIntrouvableError) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }
    if (erreur instanceof TransitionInvalideError) {
      return NextResponse.json({ error: "Transition invalide (la proposition n'est plus un brouillon ni émise)." }, { status: 409 });
    }
    if (erreur instanceof SnapshotIncompletError) {
      return NextResponse.json({ error: "Snapshot commercial incomplet (tjmPropose/devise/dureeJours requis)." }, { status: 400 });
    }
    if (erreur instanceof DecisionSourceNonActiveError) {
      return NextResponse.json({ error: "La décision source n'est plus active." }, { status: 409 });
    }
    throw erreur;
  }
}
