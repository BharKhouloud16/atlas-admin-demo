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
  evaluationVisiblePour,
  listerInterviewEvaluations,
} from "@/lib/interview/evaluation";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.4, §9, §15. Réservé au Client propriétaire de la DemandeTalent portée
// par l'Interview — l'ownership réelle ("participant ACCEPTEE sur CET
// Interview") est revérifiée par le service lui-même (jamais seulement
// ici). Visibilité en lecture : §10, filtrée par evaluationVisiblePour.
async function resoudreInterviewClient(interviewId: string, clientId: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, candidateSelection: { select: { demandeTalentId: true } } },
  });
  if (!interview) return null;
  const demande = await prisma.demandeTalent.findFirst({
    where: { id: interview.candidateSelection.demandeTalentId, clientId },
    select: { id: true },
  });
  return demande ? interview : null;
}

export async function GET(_req: NextRequest, { params }: { params: { interviewId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const interview = await resoudreInterviewClient(params.interviewId, session.clientId);
  if (!interview) {
    return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
  }

  const evaluations = await listerInterviewEvaluations(params.interviewId);
  const visibles = evaluations.filter((e) => evaluationVisiblePour(e, { role: "CLIENT" }));

  return NextResponse.json({ interviewId: params.interviewId, evaluations: visibles });
}

export async function POST(req: NextRequest, { params }: { params: { interviewId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const interview = await resoudreInterviewClient(params.interviewId, session.clientId);
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
      acteurRole: "CLIENT",
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
