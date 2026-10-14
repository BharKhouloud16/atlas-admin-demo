import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { interviewEvaluationSchema, premierMessageZod } from "@/lib/validation";
import {
  CriteresInvalidesError,
  DejaSupersedeError,
  InterviewIntrouvableError,
  ParticipantNonAccepteError,
  RecommandationInvalideError,
  SupersedesAutreEvaluateurError,
  SupersedesIntrouvableError,
  VOCABULAIRE_CRITERES_EVALUATION,
  creerInterviewEvaluationAvecRetry,
  listerInterviewEvaluations,
} from "@/lib/interview/evaluation";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15 Admin-facing : "ADMIN/INTERVIEWEUR_INTERNE participant". Aucun
// contournement de l'ownership réelle — le service revérifie
// systématiquement que `session.email` correspond à un InterviewParticipant
// ACCEPTEE sur CET Interview, qu'il s'agisse d'un ADMIN_RECRUTEUR ou d'un
// INTERVIEWEUR_INTERNE : un Admin qui n'est pas lui-même participant de cet
// entretien ne peut PAS l'évaluer (§1.4, "jamais une permission globale").
// Visibilité ADMIN : toutes les évaluations (evaluationVisiblePour), donc
// GET ici retourne la liste complète sans filtrage.
async function resoudreInterviewDemande(interviewId: string, demandeId: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, candidateSelection: { select: { demandeTalentId: true } } },
  });
  if (!interview || interview.candidateSelection.demandeTalentId !== demandeId) return null;
  return interview;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; interviewId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const interview = await resoudreInterviewDemande(params.interviewId, params.id);
  if (!interview) {
    return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
  }

  const evaluations = await listerInterviewEvaluations(params.interviewId);
  return NextResponse.json({ interviewId: params.interviewId, evaluations });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; interviewId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const interview = await resoudreInterviewDemande(params.interviewId, params.id);
  if (!interview) {
    return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = interviewEvaluationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    const evaluation = await creerInterviewEvaluationAvecRetry({
      interviewId: params.interviewId,
      evaluateurEmail: session.email,
      criteres: analyse.data.criteres,
      vocabulaireAutorise: VOCABULAIRE_CRITERES_EVALUATION,
      observations: analyse.data.observations,
      recommandation: analyse.data.recommandation,
      commentairesLibres: analyse.data.commentairesLibres,
      supersedesId: analyse.data.supersedesId,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "interview.evaluated",
      cible: `interview:${params.interviewId} evaluation:${evaluation.id}`,
    });

    return NextResponse.json(evaluation, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof InterviewIntrouvableError) {
      return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
    }
    if (erreur instanceof ParticipantNonAccepteError) {
      return NextResponse.json({ error: "Seul un participant ayant accepté cet entretien peut l'évaluer." }, { status: 403 });
    }
    if (erreur instanceof CriteresInvalidesError || erreur instanceof RecommandationInvalideError) {
      return NextResponse.json({ error: "Critères ou recommandation invalides." }, { status: 400 });
    }
    if (erreur instanceof SupersedesIntrouvableError || erreur instanceof SupersedesAutreEvaluateurError) {
      return NextResponse.json({ error: "Évaluation à corriger introuvable." }, { status: 404 });
    }
    if (erreur instanceof DejaSupersedeError) {
      return NextResponse.json({ error: "Cette évaluation a déjà été corrigée." }, { status: 409 });
    }
    throw erreur;
  }
}
