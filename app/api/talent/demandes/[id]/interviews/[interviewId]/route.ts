import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { envoyerEmailAnnulationEntretien, envoyerEmailModificationEntretien } from "@/lib/email";
import { interviewPatchSchema, premierMessageZod } from "@/lib/validation";
import { InterviewIntrouvableError, TransitionInterviewInvalideError, annulerInterviewAvecRetry, reprogrammerInterviewAvecRetry } from "@/lib/interview/service";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15 Admin-facing. L'id de l'URL sélectionne UNIQUEMENT quel Interview —
// la revérification `candidateSelection.demandeTalentId === params.id` est
// faite explicitement (même discipline IDOR que le reste du dépôt).
async function resoudreInterviewDemande(interviewId: string, demandeId: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { participants: true, candidateSelection: { select: { demandeTalentId: true } } },
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

  return NextResponse.json(interview);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; interviewId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const interview = await resoudreInterviewDemande(params.interviewId, params.id);
  if (!interview) {
    return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = interviewPatchSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    if (analyse.data.action === "reschedule") {
      const misAJour = await reprogrammerInterviewAvecRetry({
        interviewId: params.interviewId,
        dateHeure: analyse.data.dateHeure ? new Date(analyse.data.dateHeure) : undefined,
        dureeMinutes: analyse.data.dureeMinutes,
        canal: analyse.data.canal,
        lieu: analyse.data.lieu,
      });

      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "interview.rescheduled",
        cible: `interview:${params.interviewId}`,
      });

      // §10 — email de modification, tous les participants, nouvelle date.
      for (const participant of interview.participants) {
        void envoyerEmailModificationEntretien({
          to: participant.emailParticipant,
          dateHeure: misAJour.dateHeure,
          dureeMinutes: misAJour.dureeMinutes,
          canal: misAJour.canal,
          lieu: misAJour.lieu,
          timezoneSaisie: misAJour.timezoneSaisie,
        });
      }

      return NextResponse.json(misAJour);
    }

    const misAJour = await annulerInterviewAvecRetry({
      interviewId: params.interviewId,
      annuleParEmail: session.email,
      motifAnnulation: analyse.data.motifAnnulation,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "interview.cancelled",
      cible: `interview:${params.interviewId}`,
      detail: analyse.data.motifAnnulation,
    });

    // §10 — email d'annulation, tous les participants.
    for (const participant of interview.participants) {
      void envoyerEmailAnnulationEntretien({
        to: participant.emailParticipant,
        dateHeure: misAJour.dateHeure,
        timezoneSaisie: misAJour.timezoneSaisie,
        motifAnnulation: misAJour.motifAnnulation,
      });
    }

    return NextResponse.json(misAJour);
  } catch (erreur) {
    if (erreur instanceof InterviewIntrouvableError) {
      return NextResponse.json({ error: "Entretien introuvable." }, { status: 404 });
    }
    if (erreur instanceof TransitionInterviewInvalideError) {
      return NextResponse.json({ error: "Cet entretien est déjà dans un état terminal." }, { status: 409 });
    }
    throw erreur;
  }
}
