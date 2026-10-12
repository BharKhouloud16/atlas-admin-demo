import { Prisma } from "@prisma/client";
import type { InterviewCanal, InterviewParticipantRole, InterviewStatut, StatutInvitation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  annulerRemindersPourInterview,
  annulerRemindersPourParticipant,
  genererRemindersPourParticipants,
  regenererRemindersPourInterview,
} from "@/lib/interview/reminders";
import { annulerSync, resynchroniserApresReprogrammation } from "@/lib/calendar/sync";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.2, §1.3, §4, §8. Service pur du domaine Interview — aucun envoi
// d'email ici (ajouté par les routes qui appellent ce service, jamais
// l'inverse — Ordre d'implémentation §20). Le cycle de vie des
// InterviewReminder (génération/régénération/annulation, §1.6/§12) est en
// revanche géré directement par ce service, aux points de transition
// exacts qu'il contrôle déjà — jamais dupliqué dans les routes API.
//
// CORRECTIF P1 (audit §14.1) — la resynchronisation/l'annulation calendrier
// (`lib/calendar/sync.ts`) sont désormais déclenchées depuis les wrappers
// `*AvecRetry` ci-dessous, **jamais depuis l'intérieur d'une transaction**
// (`tx`) : ce sont des appels best-effort vers un système externe découplé
// (§1.7/§9) — ils s'exécutent uniquement APRÈS que la transaction métier a
// committé, et une exception levée par eux est systématiquement interceptée
// localement, jamais propagée : une panne calendrier ne peut donc jamais
// annuler ni corrompre une transition métier déjà persistée.
//
// RBAC : contrôlé exclusivement par l'appelant (route API) — ce module ne
// vérifie jamais session.role lui-même, même discipline que
// lib/mission/assignment.ts.

export class CandidateSelectionReferenceIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_SELECTION_REFERENCE_INTROUVABLE");
  }
}

export class CandidateSelectionReferenceNonActiveError extends Error {
  constructor() {
    super("CANDIDATE_SELECTION_REFERENCE_NON_ACTIVE");
  }
}

export class OrganisateurUniqueRequisError extends Error {
  constructor() {
    super("ORGANISATEUR_UNIQUE_REQUIS");
  }
}

export class CandidatParticipantRequisError extends Error {
  constructor() {
    super("CANDIDAT_PARTICIPANT_REQUIS");
  }
}

export class ParticipantDupliqueError extends Error {
  constructor() {
    super("PARTICIPANT_DUPLIQUE");
  }
}

export class InterviewIntrouvableError extends Error {
  constructor() {
    super("INTERVIEW_INTROUVABLE");
  }
}

export class InterviewParticipantIntrouvableError extends Error {
  constructor() {
    super("INTERVIEW_PARTICIPANT_INTROUVABLE");
  }
}

export class ReponseSurInterviewTermineeError extends Error {
  constructor() {
    super("REPONSE_SUR_INTERVIEW_TERMINEE");
  }
}

export class TransitionInterviewInvalideError extends Error {
  constructor(public readonly depuis: InterviewStatut, public readonly vers: InterviewStatut) {
    super("TRANSITION_INTERVIEW_INVALIDE");
  }
}

const MAX_TENTATIVES = 3;

// §8 — critère CONFIRME, implémentation exacte du contrat : aucune
// agrégation numérique, aucun seuil de pourcentage, aucune IA.
export function peutConfirmer(participants: { role: InterviewParticipantRole; estOrganisateur: boolean; statutInvitation: StatutInvitation }[]): boolean {
  const requis = participants.filter((p) => p.role === "CANDIDAT" || p.estOrganisateur);
  return requis.length > 0 && requis.every((p) => p.statutInvitation === "ACCEPTEE");
}

export type CreationInterviewParticipantInput = {
  role: InterviewParticipantRole;
  emailParticipant: string;
  profilId?: string;
  fonctionDeclaree?: string;
  estOrganisateur?: boolean;
  telephoneInterview?: string;
};

export type CreationInterviewParams = {
  candidateSelectionId: string;
  demandeTalentId: string; // revérifié ici en plus de l'appelant
  canal: InterviewCanal;
  dateHeure: Date;
  dureeMinutes: number;
  timezoneSaisie: string;
  lieu?: string;
  objectif?: string;
  createdByEmail: string;
  participants: CreationInterviewParticipantInput[];
};

function validerParticipants(participants: CreationInterviewParticipantInput[]) {
  const organisateurs = participants.filter((p) => p.estOrganisateur === true);
  if (organisateurs.length !== 1) throw new OrganisateurUniqueRequisError();

  const candidats = participants.filter((p) => p.role === "CANDIDAT");
  if (candidats.length !== 1 || !candidats[0].profilId) throw new CandidatParticipantRequisError();

  const emails = new Set<string>();
  for (const p of participants) {
    if (emails.has(p.emailParticipant)) throw new ParticipantDupliqueError();
    emails.add(p.emailParticipant);
  }
}

async function creerInterview(tx: Prisma.TransactionClient, params: CreationInterviewParams) {
  const candidateSelection = await tx.candidateSelection.findUnique({
    where: { id: params.candidateSelectionId },
    select: { id: true, demandeTalentId: true, statut: true },
  });
  if (!candidateSelection || candidateSelection.demandeTalentId !== params.demandeTalentId) {
    throw new CandidateSelectionReferenceIntrouvableError();
  }
  if (candidateSelection.statut !== "ACTIVE") throw new CandidateSelectionReferenceNonActiveError();

  validerParticipants(params.participants);

  const interview = await tx.interview.create({
    data: {
      candidateSelectionId: params.candidateSelectionId,
      canal: params.canal,
      dateHeure: params.dateHeure,
      dureeMinutes: params.dureeMinutes,
      timezoneSaisie: params.timezoneSaisie,
      lieu: params.lieu,
      objectif: params.objectif,
      createdByEmail: params.createdByEmail,
      participants: {
        create: params.participants.map((p) => ({
          role: p.role,
          emailParticipant: p.emailParticipant,
          profilId: p.profilId,
          fonctionDeclaree: p.fonctionDeclaree,
          estOrganisateur: p.estOrganisateur ?? false,
          telephoneInterview: p.telephoneInterview,
        })),
      },
    },
    include: { participants: true },
  });

  // Relecture DANS la transaction — confirme l'invariant réellement
  // persisté, jamais seulement validé sur l'input (même discipline que
  // creerAssignment relisant responsablePrincipalExistant).
  const organisateursPersistes = interview.participants.filter((p) => p.estOrganisateur).length;
  if (organisateursPersistes !== 1) throw new OrganisateurUniqueRequisError();

  // §12 — génération des InterviewReminder à la création de l'Interview,
  // une fois la dateHeure connue, dans la même transaction.
  await genererRemindersPourParticipants(tx, interview.participants.map((p) => p.id), interview.dateHeure);

  return interview;
}

export async function creerInterviewAvecRetry(params: CreationInterviewParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerInterview(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_INTERVIEW_CONCURRENCE");
}

// Lecture seule.
export async function lireInterview(interviewId: string) {
  return prisma.interview.findUnique({ where: { id: interviewId }, include: { participants: true } });
}

export async function listerInterviewsCandidateSelection(candidateSelectionId: string) {
  return prisma.interview.findMany({
    where: { candidateSelectionId },
    include: { participants: true },
    orderBy: { createdAt: "asc" },
  });
}

export type ReponseInvitationParams = {
  interviewId: string;
  participantId: string;
  statutInvitation: "ACCEPTEE" | "REFUSEE" | "CRENEAU_ALTERNATIF_PROPOSE";
  messageReponse?: string;
};

export type ReponseInvitationResultat = {
  participant: Awaited<ReturnType<typeof prisma.interviewParticipant.update>>;
  interview: Awaited<ReturnType<typeof prisma.interview.update>> | null;
};

// §4, §8, §1.3 — enregistre la réponse d'un participant et applique les
// transitions dérivées de l'Interview (PLANIFIE -> CONFIRME si le critère
// est atteint ; (PLANIFIE|CONFIRME) -> ANNULE si un participant requis
// (CANDIDAT ou organisateur) refuse).
//
// CORRECTIF P1 (audit docs/audits/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_AUDIT.md
// §8.1) — isolation Serializable+retry P2034, PAS la transaction par défaut
// documentée à l'origine par le contrat §14 ("pas de concurrence multi-
// lignes à protéger"). Cette justification s'est révélée incorrecte à
// l'audit : `peutConfirmer()` dépend de l'état de TOUS les participants
// requis, pas seulement de la ligne mise à jour par cet appel — deux
// réponses ACCEPTEE quasi simultanées (ex. CANDIDAT et organisateur
// répondant à la même seconde) pouvaient chacune lire l'état de l'autre
// AVANT son commit sous isolation par défaut (READ COMMITTED), chacune
// concluant à tort `peutConfirmer() === false`, et la transition CONFIRME
// était alors silencieusement manquée (les deux participants ACCEPTEE en
// base, mais Interview.statut resté PLANIFIE). Serializable fait détecter ce
// conflit par Postgres (P2034) et le retry relit un état à jour — même
// pattern que creerInterviewAvecRetry/reprogrammerInterviewAvecRetry
// ci-dessus, jamais une nouvelle machine d'état.
async function enregistrerReponseInvitation(
  tx: Prisma.TransactionClient,
  params: ReponseInvitationParams
): Promise<ReponseInvitationResultat> {
  const interview = await tx.interview.findUnique({ where: { id: params.interviewId }, include: { participants: true } });
  if (!interview) throw new InterviewIntrouvableError();

  const participant = interview.participants.find((p) => p.id === params.participantId);
  if (!participant) throw new InterviewParticipantIntrouvableError();

  if (interview.statut === "TERMINE" || interview.statut === "ANNULE" || interview.statut === "ABSENT") {
    throw new ReponseSurInterviewTermineeError();
  }

  const participantMisAJour = await tx.interviewParticipant.update({
    where: { id: params.participantId },
    data: {
      statutInvitation: params.statutInvitation,
      reponseLe: new Date(),
      messageReponse: params.messageReponse,
    },
  });

  const participantsMisAJour = interview.participants.map((p) => (p.id === participantMisAJour.id ? participantMisAJour : p));

  const estParticipantRequis = participant.role === "CANDIDAT" || participant.estOrganisateur;

  let interviewMiseAJour: Awaited<ReturnType<typeof prisma.interview.update>> | null = null;

  if (params.statutInvitation === "REFUSEE" && estParticipantRequis) {
    interviewMiseAJour = await tx.interview.update({
      where: { id: interview.id },
      data: {
        statut: "ANNULE",
        annuleParEmail: participant.emailParticipant,
        motifAnnulation: `Refus du participant requis (${participant.role})`,
      },
    });
    // §1.6 — Interview devenu terminal : tous les rappels PLANIFIE de tous
    // les participants sont annulés (superset du cas individuel ci-dessous).
    await annulerRemindersPourInterview(tx, interview.id);
  } else {
    if (params.statutInvitation === "REFUSEE") {
      // §1.6 — un participant non requis qui refuse n'annule pas
      // l'Interview, mais ses propres rappels deviennent sans objet.
      await annulerRemindersPourParticipant(tx, participant.id);
    }
    if (interview.statut === "PLANIFIE" && peutConfirmer(participantsMisAJour)) {
      interviewMiseAJour = await tx.interview.update({ where: { id: interview.id }, data: { statut: "CONFIRME" } });
    }
  }

  return { participant: participantMisAJour, interview: interviewMiseAJour };
}

// CORRECTIF P1 (audit §14.1) — resynchronisation/annulation calendrier
// best-effort, toujours APRÈS commit de la transaction métier (jamais dans
// `tx`), toujours interceptée localement : voir commentaire de tête de
// fichier. `resynchroniserApresReprogrammation`/`annulerSync` elles-mêmes ne
// marquent jamais un succès simulé (aucun provider réel connecté) ni ne
// créent de faux événement externe — ce module se contente de les appeler
// au bon moment, sans changer leur comportement interne.
async function resynchroniserCalendrierPourInterview(interview: {
  id: string;
  dateHeure: Date;
  dureeMinutes: number;
  canal: InterviewCanal;
  lieu: string | null;
  meetingUrl: string | null;
}) {
  const participants = await prisma.interviewParticipant.findMany({ where: { interviewId: interview.id }, select: { id: true } });
  for (const participant of participants) {
    try {
      await resynchroniserApresReprogrammation(participant.id, {
        dateHeure: interview.dateHeure,
        dureeMinutes: interview.dureeMinutes,
        canal: interview.canal,
        lieu: interview.lieu,
        meetingUrl: interview.meetingUrl,
      });
    } catch {
      // best-effort — une panne calendrier ne doit jamais remonter ici.
    }
  }
}

async function annulerCalendrierPourInterview(interviewId: string) {
  const participants = await prisma.interviewParticipant.findMany({ where: { interviewId }, select: { id: true } });
  for (const participant of participants) {
    try {
      await annulerSync(participant.id);
    } catch {
      // best-effort — une panne calendrier ne doit jamais remonter ici.
    }
  }
}

export async function enregistrerReponseInvitationAvecRetry(params: ReponseInvitationParams) {
  let resultat: ReponseInvitationResultat | undefined;
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      resultat = await prisma.$transaction((tx) => enregistrerReponseInvitation(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      break;
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  if (!resultat) throw new Error("ECHEC_INTERVIEW_CONCURRENCE");

  // §1.6/§9 — un refus requis qui annule l'Interview (voir
  // enregistrerReponseInvitation) annule aussi la synchronisation
  // calendrier de tous les participants, même discipline que les rappels.
  if (resultat.interview?.statut === "ANNULE") {
    await annulerCalendrierPourInterview(params.interviewId);
  }

  return resultat;
}

export type ReprogrammationInterviewParams = {
  interviewId: string;
  dateHeure?: Date;
  dureeMinutes?: number;
  canal?: InterviewCanal;
  lieu?: string;
};

// §1.2 — rescheduling explicite : même ligne mise à jour, jamais une
// nouvelle ligne. Ne modifie jamais `statut` par construction (seuls les
// 4 champs listés par le contrat sont réécrits).
async function reprogrammerInterview(tx: Prisma.TransactionClient, params: ReprogrammationInterviewParams) {
  const interview = await tx.interview.findUnique({ where: { id: params.interviewId } });
  if (!interview) throw new InterviewIntrouvableError();
  if (interview.statut === "TERMINE" || interview.statut === "ANNULE" || interview.statut === "ABSENT") {
    throw new TransitionInterviewInvalideError(interview.statut, interview.statut);
  }

  const interviewMisAJour = await tx.interview.update({
    where: { id: params.interviewId },
    data: {
      dateHeure: params.dateHeure,
      dureeMinutes: params.dureeMinutes,
      canal: params.canal,
      lieu: params.lieu,
    },
  });

  // §1.6 — un rescheduling régénère les rappels PLANIFIE pour la nouvelle
  // dateHeure, uniquement si dateHeure a effectivement changé.
  if (params.dateHeure !== undefined) {
    await regenererRemindersPourInterview(tx, params.interviewId, interviewMisAJour.dateHeure);
  }

  return interviewMisAJour;
}

export async function reprogrammerInterviewAvecRetry(params: ReprogrammationInterviewParams) {
  let interviewMisAJour: Awaited<ReturnType<typeof reprogrammerInterview>> | undefined;
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      interviewMisAJour = await prisma.$transaction((tx) => reprogrammerInterview(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      break;
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  if (!interviewMisAJour) throw new Error("ECHEC_INTERVIEW_CONCURRENCE");

  // CORRECTIF P1 (audit §14.1) — même condition que la régénération des
  // rappels ci-dessus : une resynchronisation calendrier n'a de sens que si
  // la dateHeure a effectivement changé.
  if (params.dateHeure !== undefined) {
    await resynchroniserCalendrierPourInterview(interviewMisAJour);
  }

  return interviewMisAJour;
}

const TRANSITIONS_AUTORISEES: Record<"ANNULE" | "ABSENT" | "TERMINE", InterviewStatut[]> = {
  ANNULE: ["PLANIFIE", "CONFIRME"],
  ABSENT: ["PLANIFIE", "CONFIRME"],
  TERMINE: ["CONFIRME"],
};

export type TransitionInterviewParams = {
  interviewId: string;
  annuleParEmail?: string;
  motifAnnulation?: string;
};

async function transitionnerInterview(
  tx: Prisma.TransactionClient,
  params: TransitionInterviewParams,
  versStatut: "ANNULE" | "ABSENT" | "TERMINE"
) {
  const interview = await tx.interview.findUnique({ where: { id: params.interviewId } });
  if (!interview) throw new InterviewIntrouvableError();
  if (!TRANSITIONS_AUTORISEES[versStatut].includes(interview.statut)) {
    throw new TransitionInterviewInvalideError(interview.statut, versStatut);
  }

  const interviewMisAJour = await tx.interview.update({
    where: { id: params.interviewId },
    data: {
      statut: versStatut,
      annuleParEmail: versStatut === "ANNULE" ? params.annuleParEmail : undefined,
      annuleLe: versStatut === "ANNULE" ? new Date() : undefined,
      motifAnnulation: versStatut === "ANNULE" ? params.motifAnnulation : undefined,
    },
  });

  // §1.6 — Interview devenu terminal (ANNULE/ABSENT/TERMINE) : tous les
  // rappels PLANIFIE restants (tous participants) sont annulés.
  await annulerRemindersPourInterview(tx, params.interviewId);

  return interviewMisAJour;
}

async function transitionnerInterviewAvecRetry(params: TransitionInterviewParams, versStatut: "ANNULE" | "ABSENT" | "TERMINE") {
  let interviewMisAJour: Awaited<ReturnType<typeof transitionnerInterview>> | undefined;
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      interviewMisAJour = await prisma.$transaction((tx) => transitionnerInterview(tx, params, versStatut), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      break;
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  if (!interviewMisAJour) throw new Error("ECHEC_INTERVIEW_CONCURRENCE");

  // CORRECTIF P1 (audit §14.1) — annulation calendrier raccordée au chemin
  // effectif d'annulation Admin (jamais ABSENT/TERMINE, qui ne sont pas une
  // "annulation" au sens du contrat §9/§11).
  if (versStatut === "ANNULE") {
    await annulerCalendrierPourInterview(params.interviewId);
  }

  return interviewMisAJour;
}

// (PLANIFIE|CONFIRME) -> ANNULE, annulation Admin.
export async function annulerInterviewAvecRetry(params: TransitionInterviewParams) {
  return transitionnerInterviewAvecRetry(params, "ANNULE");
}

// (PLANIFIE|CONFIRME) -> ABSENT, constat Admin le jour J.
export async function marquerAbsentInterviewAvecRetry(params: Pick<TransitionInterviewParams, "interviewId">) {
  return transitionnerInterviewAvecRetry(params, "ABSENT");
}

// CONFIRME -> TERMINE, constat Admin manuel après la date.
export async function terminerInterviewAvecRetry(params: Pick<TransitionInterviewParams, "interviewId">) {
  return transitionnerInterviewAvecRetry(params, "TERMINE");
}
