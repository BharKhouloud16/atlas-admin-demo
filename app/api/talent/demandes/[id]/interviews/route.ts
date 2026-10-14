import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { creerUrlSignee } from "@/lib/url-signee";
import { envoyerEmailInvitationEntretien } from "@/lib/email";
import { interviewCreationSchema, premierMessageZod } from "@/lib/validation";
import {
  CandidatParticipantRequisError,
  CandidateSelectionReferenceIntrouvableError,
  CandidateSelectionReferenceNonActiveError,
  OrganisateurUniqueRequisError,
  ParticipantDupliqueError,
  creerInterviewAvecRetry,
} from "@/lib/interview/service";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15 Admin-facing, §20 ("5. Interview / InterviewParticipant (API +
// logique, email d'invitation)"). Extension du namespace existant
// app/api/talent/demandes/[id]/ — réservé à l'Admin (jamais le Client :
// "le Client sélectionne, l'Admin planifie", §1.2).
const DUREE_MAX_TOKEN_SEC = 60 * 24 * 60 * 60; // 60 jours, plafond de sûreté
const DUREE_MIN_TOKEN_SEC = 60 * 60; // 1 heure, plancher pour un entretien imminent

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const selections = await prisma.candidateSelection.findMany({ where: { demandeTalentId: params.id }, select: { id: true } });
  const interviews = await prisma.interview.findMany({
    where: { candidateSelectionId: { in: selections.map((s) => s.id) } },
    include: { participants: true },
    orderBy: { dateHeure: "asc" },
  });

  return NextResponse.json({ demandeId: params.id, interviews });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = interviewCreationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  try {
    const interview = await creerInterviewAvecRetry({
      candidateSelectionId: donnees.candidateSelectionId,
      demandeTalentId: params.id,
      canal: donnees.canal,
      dateHeure: new Date(donnees.dateHeure),
      dureeMinutes: donnees.dureeMinutes,
      timezoneSaisie: donnees.timezoneSaisie,
      lieu: donnees.lieu,
      objectif: donnees.objectif,
      createdByEmail: session.email,
      participants: donnees.participants,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "interview.created",
      cible: `demande:${params.id} interview:${interview.id}`,
    });

    // §10 — email d'invitation, un par InterviewParticipant créé.
    // Best-effort, jamais bloquant pour la réponse HTTP de création.
    const dureeTokenSec = Math.min(
      DUREE_MAX_TOKEN_SEC,
      Math.max(DUREE_MIN_TOKEN_SEC, Math.round((interview.dateHeure.getTime() - Date.now()) / 1000))
    );
    for (const participant of interview.participants) {
      const { token } = creerUrlSignee(`interview-participant:${interview.id}:${participant.id}`, dureeTokenSec);
      void envoyerEmailInvitationEntretien({
        to: participant.emailParticipant,
        token,
        dateHeure: interview.dateHeure,
        dureeMinutes: interview.dureeMinutes,
        canal: interview.canal,
        lieu: interview.lieu,
        objectif: interview.objectif,
        timezoneSaisie: interview.timezoneSaisie,
      });
      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "interview.invited",
        cible: `interview:${interview.id} participant:${participant.id}`,
      });
    }

    return NextResponse.json(interview, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof CandidateSelectionReferenceIntrouvableError) {
      return NextResponse.json({ error: "Sélection candidat introuvable." }, { status: 404 });
    }
    if (erreur instanceof CandidateSelectionReferenceNonActiveError) {
      return NextResponse.json({ error: "Cette sélection candidat n'est plus active." }, { status: 409 });
    }
    if (erreur instanceof OrganisateurUniqueRequisError) {
      return NextResponse.json({ error: "Exactement un participant organisateur est requis." }, { status: 400 });
    }
    if (erreur instanceof CandidatParticipantRequisError) {
      return NextResponse.json({ error: "Exactement un participant de rôle CANDIDAT (avec profilId) est requis." }, { status: 400 });
    }
    if (erreur instanceof ParticipantDupliqueError) {
      return NextResponse.json({ error: "Un email de participant est dupliqué." }, { status: 400 });
    }
    throw erreur;
  }
}
