import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import {
  CandidateSelectionIntrouvableError,
  CandidateSelectionNonActiveError,
  retirerCandidateSelectionAvecRetry,
} from "@/lib/candidate-selection/service";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §3, §15. "Introuvable" et "appartient à une autre DemandeTalent/un autre
// Client" produisent la MÊME erreur 404 — jamais une fuite d'existence
// IDOR (même doctrine que /api/client/besoins/[id]).
export async function DELETE(_req: NextRequest, { params }: { params: { selectionId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const selection = await prisma.candidateSelection.findUnique({ where: { id: params.selectionId } });
  if (!selection) {
    return NextResponse.json({ error: "Sélection introuvable." }, { status: 404 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: selection.demandeTalentId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Sélection introuvable." }, { status: 404 });
  }

  try {
    const misAJour = await retirerCandidateSelectionAvecRetry({
      selectionId: params.selectionId,
      demandeTalentId: selection.demandeTalentId,
      retireeParEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "CLIENT",
      action: "candidate.selection.cancelled",
      cible: `selection:${params.selectionId}`,
    });

    return NextResponse.json(misAJour);
  } catch (erreur) {
    if (erreur instanceof CandidateSelectionIntrouvableError) {
      return NextResponse.json({ error: "Sélection introuvable." }, { status: 404 });
    }
    if (erreur instanceof CandidateSelectionNonActiveError) {
      return NextResponse.json({ error: "Cette sélection n'est plus active." }, { status: 409 });
    }
    throw erreur;
  }
}
