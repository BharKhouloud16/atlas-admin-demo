import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { listerCandidateProposalsDemandeTalent } from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §10.3.
// CLIENT exclusif, scoping tenant par session.clientId. Filtre : exclut
// systématiquement les lignes BROUILLON (jamais visibles côté Client, §8.1
// Design Contract) — même discipline IDOR que
// app/api/client/talent-selection/demandes/[demandeId]/final-decision/route.ts.
export async function GET(_req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: params.demandeId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const toutes = await listerCandidateProposalsDemandeTalent(params.demandeId);
  const visibles = toutes.filter((p) => p.statut !== "BROUILLON");
  return NextResponse.json({ demandeId: params.demandeId, propositions: visibles });
}
