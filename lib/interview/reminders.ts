import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envoyerEmailRappelEntretien } from "@/lib/email";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.6, §12.
//
// Aucun scheduler générique n'est créé ici (interdiction explicite du
// mandat — ce dépôt n'a aucun mécanisme périodique existant). Ce module
// expose uniquement : (1) la génération/régénération/annulation des lignes
// InterviewReminder, appelées par lib/interview/service.ts aux points de
// transition concernés, et (2) `traiterRappelsDus()`, le traitement
// effectif d'un lot de rappels dus — appelée exclusivement par
// app/api/internal/interview-reminders/process/route.ts, elle-même
// déclenchée par un cron EXTERNE à ATLAS (infrastructure d'hébergement).
//
// Configuration centralisée (§12 : "pas en dur dans chaque service") —
// un seul point de définition pour les délais par défaut.
export const DELAIS_RAPPEL_MINUTES_PAR_DEFAUT = [1440, 60] as const;

function calculerDeclencheA(dateHeure: Date, delaiAvantMinutes: number): Date {
  return new Date(dateHeure.getTime() - delaiAvantMinutes * 60_000);
}

// Appelé depuis la transaction de création d'un Interview
// (lib/interview/service.ts::creerInterview) — une ligne par
// (participant, délai), §12. Idempotence structurelle via
// @@unique([interviewParticipantId, delaiAvantMinutes]) : un appel rejoué
// sur les mêmes participants échouerait sur cette contrainte plutôt que de
// dupliquer silencieusement.
export async function genererRemindersPourParticipants(
  tx: Prisma.TransactionClient,
  participantIds: string[],
  dateHeure: Date,
  delaisMinutes: readonly number[] = DELAIS_RAPPEL_MINUTES_PAR_DEFAUT
) {
  if (participantIds.length === 0) return;
  await tx.interviewReminder.createMany({
    data: participantIds.flatMap((interviewParticipantId) =>
      delaisMinutes.map((delaiAvantMinutes) => ({
        interviewParticipantId,
        delaiAvantMinutes,
        declencheA: calculerDeclencheA(dateHeure, delaiAvantMinutes),
      }))
    ),
  });
}

// Rescheduling (§1.6) : hard-delete des lignes PLANIFIE existantes (jamais
// un fait métier/audité en soi, contrairement aux autres objets — décision
// explicite du contrat) puis recréation pour la nouvelle dateHeure. Les
// lignes déjà ENVOYE/ANNULE/ECHEC restent intactes (historique technique).
export async function regenererRemindersPourInterview(
  tx: Prisma.TransactionClient,
  interviewId: string,
  nouvelleDateHeure: Date,
  delaisMinutes: readonly number[] = DELAIS_RAPPEL_MINUTES_PAR_DEFAUT
) {
  const participants = await tx.interviewParticipant.findMany({ where: { interviewId }, select: { id: true } });
  await tx.interviewReminder.deleteMany({
    where: { interviewParticipantId: { in: participants.map((p) => p.id) }, statutEnvoi: "PLANIFIE" },
  });
  await genererRemindersPourParticipants(tx, participants.map((p) => p.id), nouvelleDateHeure, delaisMinutes);
}

// §1.6 : un InterviewParticipant qui change de statut avant déclenchement
// (refus) voit ses rappels PLANIFIE annulés — transition de statut, jamais
// un hard-delete (contrairement au rescheduling).
export async function annulerRemindersPourParticipant(tx: Prisma.TransactionClient, interviewParticipantId: string) {
  await tx.interviewReminder.updateMany({
    where: { interviewParticipantId, statutEnvoi: "PLANIFIE" },
    data: { statutEnvoi: "ANNULE" },
  });
}

// §1.6 : l'Interview devient terminal (ANNULE/ABSENT/TERMINE) -> tous ses
// rappels PLANIFIE (tous participants) sont annulés.
export async function annulerRemindersPourInterview(tx: Prisma.TransactionClient, interviewId: string) {
  const participants = await tx.interviewParticipant.findMany({ where: { interviewId }, select: { id: true } });
  await tx.interviewReminder.updateMany({
    where: { interviewParticipantId: { in: participants.map((p) => p.id) }, statutEnvoi: "PLANIFIE" },
    data: { statutEnvoi: "ANNULE" },
  });
}

export type TraitementRappelsResultat = { examines: number; envoyes: number; echecs: number; annules: number };

// §12 — point d'entrée unique de traitement, appelé par la route interne.
// Chaque ligne est traitée indépendamment (failure isolée par ligne).
//
// Protection concurrence/rejeu : la revendication d'une ligne se fait par
// un UPDATE conditionnel atomique (WHERE id + statutEnvoi: "PLANIFIE") —
// une seule invocation concurrente peut "gagner" une ligne donnée ; toute
// invocation rejouée ou qui chevauche celle-ci voit `count: 0` sur cette
// même ligne et ne la retraite jamais (déjà ENVOYE/ANNULE/ECHEC). La
// revendication précède systématiquement l'effet de bord (envoi email) —
// jamais l'inverse — pour garantir qu'un envoi réel ne soit jamais
// déclenché deux fois pour la même ligne.
export async function traiterRappelsDus(maintenant: Date = new Date(), limite = 200): Promise<TraitementRappelsResultat> {
  const dus = await prisma.interviewReminder.findMany({
    where: { statutEnvoi: "PLANIFIE", declencheA: { lte: maintenant } },
    take: limite,
    orderBy: { declencheA: "asc" },
    include: { interviewParticipant: { include: { interview: true } } },
  });

  const resultat: TraitementRappelsResultat = { examines: dus.length, envoyes: 0, echecs: 0, annules: 0 };

  for (const reminder of dus) {
    const participant = reminder.interviewParticipant;
    const interview = participant.interview;

    // Revérification du statut au moment du traitement (§12) — jamais une
    // confiance aveugle dans l'état au moment de la génération du rappel.
    const interviewTerminal = interview.statut === "ANNULE" || interview.statut === "ABSENT" || interview.statut === "TERMINE";
    const participantRefuse = participant.statutInvitation === "REFUSEE";

    if (interviewTerminal || participantRefuse) {
      const annulation = await prisma.interviewReminder.updateMany({
        where: { id: reminder.id, statutEnvoi: "PLANIFIE" },
        data: { statutEnvoi: "ANNULE" },
      });
      if (annulation.count > 0) resultat.annules++;
      continue;
    }

    // Revendication atomique — AVANT l'envoi réel, jamais après.
    const revendication = await prisma.interviewReminder.updateMany({
      where: { id: reminder.id, statutEnvoi: "PLANIFIE" },
      data: { statutEnvoi: "ENVOYE", envoyeLe: maintenant },
    });
    if (revendication.count === 0) continue; // déjà traité par un appel concurrent/rejoué

    const succes = await envoyerEmailRappelEntretien({
      to: participant.emailParticipant,
      dateHeure: interview.dateHeure,
      dureeMinutes: interview.dureeMinutes,
      canal: interview.canal,
      lieu: interview.lieu,
      meetingUrl: interview.meetingUrl,
      timezoneSaisie: interview.timezoneSaisie,
      delaiAvantMinutes: reminder.delaiAvantMinutes,
    });

    if (succes) {
      resultat.envoyes++;
    } else {
      await prisma.interviewReminder.update({ where: { id: reminder.id }, data: { statutEnvoi: "ECHEC" } });
      resultat.echecs++;
    }
  }

  return resultat;
}
