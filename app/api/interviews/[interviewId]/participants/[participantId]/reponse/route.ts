import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { verifierUrlSignee } from "@/lib/url-signee";
import { envoyerEmailConfirmationEntretien, envoyerEmailAnnulationEntretien, envoyerEmailRefusEntretien } from "@/lib/email";
import { declencherSyncApresAcceptation } from "@/lib/calendar/sync";
import { interviewParticipantReponseSchema, premierMessageZod } from "@/lib/validation";
import {
  InterviewIntrouvableError,
  InterviewParticipantIntrouvableError,
  ReponseSurInterviewTermineeError,
  enregistrerReponseInvitationAvecRetry,
} from "@/lib/interview/service";
import type { InterviewParticipantRole } from "@prisma/client";

// JournalActivite::acteurRole porte le vocabulaire des rôles PLATEFORME
// (ADMIN/INGENIEUR/CLIENT), distinct d'InterviewParticipantRole (rôle dans
// CET entretien). Mapping explicite plutôt qu'une valeur arbitraire —
// cette route n'a aucune session pour lire le rôle réel de l'appelant.
const ACTEUR_ROLE_PAR_PARTICIPANT: Record<InterviewParticipantRole, "ADMIN" | "INGENIEUR" | "CLIENT"> = {
  CANDIDAT: "INGENIEUR",
  CLIENT: "CLIENT",
  ADMIN_RECRUTEUR: "ADMIN",
  INTERVIEWEUR_INTERNE: "INGENIEUR",
};

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15 ("Sans session (jeton signé, pattern verifier-email)"). Volontairement
// absent de middleware.ts::config.matcher : AUCUNE session n'est attendue
// ici — un candidat/participant externe répond à une invitation sans
// jamais avoir de compte ATLAS. La protection est entièrement portée par
// le jeton signé (lib/url-signee.ts, même mécanisme HMAC-SHA256 à temps
// constant que le partage de fichiers privés — aucun nouveau mécanisme
// d'authentification créé). Le jeton lie `interviewId`+`participantId`
// ensemble : impossible de réutiliser le jeton d'un participant pour
// répondre à la place d'un autre (IDOR exclu par construction de la
// ressource signée, jamais par une vérification applicative séparée).
export async function POST(req: NextRequest, { params }: { params: { interviewId: string; participantId: string } }) {
  const token = req.nextUrl.searchParams.get("token");
  const ressource = `interview-participant:${params.interviewId}:${params.participantId}`;
  if (!verifierUrlSignee(ressource, token)) {
    return NextResponse.json({ error: "Lien de réponse invalide ou expiré." }, { status: 403 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = interviewParticipantReponseSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  try {
    const resultat = await enregistrerReponseInvitationAvecRetry({
      interviewId: params.interviewId,
      participantId: params.participantId,
      statutInvitation: analyse.data.reponse,
      messageReponse: analyse.data.messageReponse,
    });

    const interviewComplet = await prisma.interview.findUnique({
      where: { id: params.interviewId },
      include: { participants: true },
    });

    await journaliser({
      acteurEmail: resultat.participant.emailParticipant,
      acteurRole: ACTEUR_ROLE_PAR_PARTICIPANT[resultat.participant.role],
      action: analyse.data.reponse === "ACCEPTEE" ? "interview.accepted" : "interview.declined",
      cible: `interview:${params.interviewId} participant:${params.participantId}`,
    });

    if (interviewComplet) {
      if (analyse.data.reponse === "ACCEPTEE") {
        // §11 — trigger unique : statutInvitation -> ACCEPTEE.
        void declencherSyncApresAcceptation(params.participantId, {
          dateHeure: interviewComplet.dateHeure,
          dureeMinutes: interviewComplet.dureeMinutes,
          canal: interviewComplet.canal,
          lieu: interviewComplet.lieu,
          meetingUrl: interviewComplet.meetingUrl,
        });
      } else {
        // §10 — notification interne à l'Admin organisateur sur un refus.
        const organisateur = interviewComplet.participants.find((p) => p.estOrganisateur);
        if (organisateur) {
          void envoyerEmailRefusEntretien({
            to: organisateur.emailParticipant,
            participantRole: resultat.participant.role,
            dateHeure: interviewComplet.dateHeure,
            timezoneSaisie: interviewComplet.timezoneSaisie,
            messageReponse: analyse.data.messageReponse,
          });
        }
      }

      // §10 — email de confirmation/annulation à TOUS les participants,
      // uniquement si CETTE réponse a réellement déclenché la transition
      // (resultat.interview n'est non-null que dans ce cas précis).
      if (resultat.interview?.statut === "CONFIRME") {
        for (const participant of interviewComplet.participants) {
          void envoyerEmailConfirmationEntretien({
            to: participant.emailParticipant,
            dateHeure: interviewComplet.dateHeure,
            dureeMinutes: interviewComplet.dureeMinutes,
            canal: interviewComplet.canal,
            lieu: interviewComplet.lieu,
            meetingUrl: interviewComplet.meetingUrl,
            timezoneSaisie: interviewComplet.timezoneSaisie,
          });
        }
      } else if (resultat.interview?.statut === "ANNULE") {
        for (const participant of interviewComplet.participants) {
          void envoyerEmailAnnulationEntretien({
            to: participant.emailParticipant,
            dateHeure: interviewComplet.dateHeure,
            timezoneSaisie: interviewComplet.timezoneSaisie,
            motifAnnulation: resultat.interview.motifAnnulation,
          });
        }
      }
    }

    return NextResponse.json({ statutInvitation: resultat.participant.statutInvitation });
  } catch (erreur) {
    if (erreur instanceof InterviewIntrouvableError || erreur instanceof InterviewParticipantIntrouvableError) {
      return NextResponse.json({ error: "Entretien ou participant introuvable." }, { status: 404 });
    }
    if (erreur instanceof ReponseSurInterviewTermineeError) {
      return NextResponse.json({ error: "Cet entretien n'accepte plus de réponse." }, { status: 409 });
    }
    throw erreur;
  }
}
