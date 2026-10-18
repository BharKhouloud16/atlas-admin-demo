import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { candidateSelectionCreationSchema, premierMessageZod } from "@/lib/validation";
import {
  creerCandidateSelectionAvecRetry,
  SelectionDejaActiveError,
  ShortlistEntreeIntrouvableError,
  ShortlistEntreeNonValideeError,
} from "@/lib/candidate-selection/service";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §3, §15. Réservé au Client propriétaire de la DemandeTalent — l'id de
// l'URL sélectionne UNIQUEMENT quelle demande, jamais quel client (même
// discipline que /api/client/besoins/[id]).
export async function GET(_req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: params.demandeId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const selections = await prisma.candidateSelection.findMany({
    where: { demandeTalentId: params.demandeId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ demandeId: params.demandeId, selections });
}

export async function POST(req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: params.demandeId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = candidateSelectionCreationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    const selection = await creerCandidateSelectionAvecRetry({
      shortlistEntreeId: analyse.data.shortlistEntreeId,
      demandeTalentId: params.demandeId,
      selectedByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "CLIENT",
      action: "candidate.selection.created",
      cible: `demande:${params.demandeId} selection:${selection.id}`,
    });

    return NextResponse.json(selection, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof ShortlistEntreeIntrouvableError) {
      return NextResponse.json({ error: "Entrée de shortlist introuvable." }, { status: 404 });
    }
    if (erreur instanceof ShortlistEntreeNonValideeError) {
      return NextResponse.json({ error: "Cette entrée de shortlist n'a pas encore été validée." }, { status: 400 });
    }
    if (erreur instanceof SelectionDejaActiveError) {
      return NextResponse.json({ error: "Ce candidat est déjà sélectionné." }, { status: 409 });
    }
    throw erreur;
  }
}
