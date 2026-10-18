import { Prisma } from "@prisma/client";
import type { WorkItemStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RAISONS_BLOCAGE, estRaisonBlocageValide } from "@/lib/mission/lifecycle";

// COMPANY ATLAS — A23 : WorkItem Foundation (05/10/2026).
//
// Service transactionnel centralisant tous les invariants WorkItem —
// jamais dispersés dans les routes (même discipline que
// lib/mission/assignment.ts/lib/mission/capability-link.ts). Ce module ne
// vérifie jamais session.role lui-même, contrôlé exclusivement par
// l'appelant (route API).
//
// INDÉPENDANCE STRICTE vis-à-vis du lifecycle Mission (A22) : ce fichier
// ne lit JAMAIS lib/mission/lifecycle.ts::executerTransitionMission, et
// n'écrit JAMAIS Mission.statut. Il importe uniquement le catalogue de
// raisons de blocage (RAISONS_BLOCAGE/estRaisonBlocageValide) — la même
// liste verrouillée que celle du lifecycle Mission (contrat A23 §19 : les
// 6 valeurs sont textuellement identiques à celles d'A22) — pour éviter
// une seconde source de vérité pour un catalogue métier déjà posé, jamais
// pour partager un comportement de transition.

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

// Création WorkItem refusée sur une Mission close (contrat A23 §10) :
// "TERMINEE freezes work, not evaluation" — après TERMINEE/ANNULEE, aucun
// nouveau travail ne peut être ajouté, même si Evidence/Quality/Outcome
// restent ouverts dans des lots futurs.
export class MissionFermeeError extends Error {
  constructor() {
    super("MISSION_FERMEE");
  }
}

export class TitreInvalideError extends Error {
  constructor() {
    super("TITRE_INVALIDE");
  }
}

export class WorkItemIntrouvableError extends Error {
  constructor() {
    super("WORK_ITEM_INTROUVABLE");
  }
}

// WorkItem dans un état terminal (TERMINE/ANNULE) : lecture seule, aucune
// modification de titre/description, jamais une réécriture silencieuse —
// correction = nouveau WorkItem (contrat A23 §22/§24/§25).
export class WorkItemTerminalError extends Error {
  constructor() {
    super("WORK_ITEM_TERMINAL");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: WorkItemStatut, public readonly vers: WorkItemStatut) {
    super("TRANSITION_INVALIDE");
  }
}

export class RaisonBlocageManquanteError extends Error {
  constructor() {
    super("RAISON_BLOCAGE_MANQUANTE");
  }
}

export class RaisonBlocageInvalideError extends Error {
  constructor() {
    super("RAISON_BLOCAGE_INVALIDE");
  }
}

export class RaisonResolutionManquanteError extends Error {
  constructor() {
    super("RAISON_RESOLUTION_MANQUANTE");
  }
}

export class MotifManquantError extends Error {
  constructor() {
    super("MOTIF_MANQUANT");
  }
}

// Matrice de transitions explicite — même discipline que
// lib/mission/lifecycle.ts::TRANSITIONS_AUTORISEES (contrat A23 §5/§30) :
// une table pure, jamais un enchaînement de `if` dispersés. Machine
// TOTALEMENT indépendante de celle de Mission : aucun des deux fichiers
// n'appelle jamais l'autre pour modifier un statut.
export const TRANSITIONS_AUTORISEES: Record<WorkItemStatut, WorkItemStatut[]> = {
  A_FAIRE: ["EN_COURS", "ANNULE"],
  EN_COURS: ["BLOQUE", "TERMINE", "ANNULE"],
  BLOQUE: ["EN_COURS", "TERMINE", "ANNULE"],
  TERMINE: [],
  ANNULE: [],
};

export function transitionAutorisee(depuis: WorkItemStatut, vers: WorkItemStatut): boolean {
  return TRANSITIONS_AUTORISEES[depuis].includes(vers);
}

export type ActionLifecycleWorkItem = "demarrer" | "bloquer" | "debloquer" | "terminer" | "annuler";

const CIBLE_PAR_ACTION: Record<ActionLifecycleWorkItem, WorkItemStatut> = {
  demarrer: "EN_COURS",
  bloquer: "BLOQUE",
  debloquer: "EN_COURS",
  terminer: "TERMINE",
  annuler: "ANNULE",
};

function titreNormalise(titre: unknown): string {
  if (typeof titre !== "string") throw new TitreInvalideError();
  const normalise = titre.trim();
  if (normalise.length === 0) throw new TitreInvalideError();
  return normalise;
}

export type CreationWorkItemParams = {
  missionId: string;
  titre: string;
  description?: string | null;
  createdByEmail: string;
};

// Statuts Mission qui gèlent toute création de nouveau WorkItem (contrat
// A23 §10) — PLANIFIEE/PRETE/EN_COURS/BLOQUEE restent toutes ouvertes à la
// préparation/exécution du plan de travail (contrat A23 §11, décision
// documentée : rien dans l'architecture A22 ne lie WorkItem au statut
// d'Assignment, donc le découpage du travail peut être préparé dès
// PLANIFIEE, avant même qu'un Talent soit affecté — PRETE et BLOQUEE sont
// de la même façon des états "ouverts", seul le gel définitif TERMINEE/
// ANNULEE interdit la création).
// A24 — exporté pour réutilisation par lib/work-item/assignment.ts : la
// même règle "TERMINEE/ANNULEE gèlent tout nouveau travail" s'applique à
// la création d'une WorkItemAssignment (contrat A24 §12/§13), jamais une
// seconde définition divergente du même fait.
export const STATUTS_MISSION_FERMES = new Set(["TERMINEE", "ANNULEE"]);

async function creerWorkItem(tx: Prisma.TransactionClient, params: CreationWorkItemParams) {
  const mission = await tx.mission.findUnique({ where: { id: params.missionId }, select: { id: true, statut: true } });
  if (!mission) throw new MissionIntrouvableError();
  if (STATUTS_MISSION_FERMES.has(mission.statut)) throw new MissionFermeeError();

  const titre = titreNormalise(params.titre);
  const description = params.description === undefined || params.description === null ? null : params.description;

  return tx.workItem.create({
    data: {
      missionId: params.missionId,
      titre,
      description,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Serializable + retry (même discipline que creerAssignmentAvecRetry/
// creerLienAvecRetry) : protège la vérification "Mission pas fermée"
// d'une course avec une transition Mission concurrente (contrat A22) —
// jamais une vérification préalable hors transaction suivie d'une
// écriture séparée.
export async function creerWorkItemAvecRetry(params: CreationWorkItemParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerWorkItem(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_WORK_ITEM_CONCURRENCE");
}

export async function listerWorkItemsMission(missionId: string) {
  return prisma.workItem.findMany({ where: { missionId }, orderBy: { createdAt: "asc" } });
}

export type LectureWorkItemParams = {
  workItemId: string;
  missionId: string;
};

// Cross-check IDOR (contrat A23 §27) — même discipline que
// lib/mission/capability-link.ts::superseder : "introuvable" et "mauvaise
// Mission parente" produisent EXACTEMENT la même erreur, jamais une fuite
// d'existence.
export async function lireWorkItem(params: LectureWorkItemParams) {
  const workItem = await prisma.workItem.findUnique({ where: { id: params.workItemId } });
  if (!workItem || workItem.missionId !== params.missionId) throw new WorkItemIntrouvableError();
  return workItem;
}

export type ModificationWorkItemParams = {
  workItemId: string;
  missionId: string;
  titre?: string;
  description?: string | null;
};

// Modifie titre/description — les SEULS champs modifiables après création
// (contrat A23 §24/§25), et uniquement tant que le WorkItem n'est pas
// terminal. missionId/createdAt/createdByEmail ne sont jamais lus depuis
// params : aucun champ de ce type n'existe même dans cette signature,
// immutabilité garantie par construction du type, jamais seulement par
// une validation (même discipline que ModificationAssignmentParams, A20).
async function modifierWorkItem(tx: Prisma.TransactionClient, params: ModificationWorkItemParams) {
  const workItem = await tx.workItem.findUnique({ where: { id: params.workItemId } });
  if (!workItem || workItem.missionId !== params.missionId) throw new WorkItemIntrouvableError();
  if (workItem.statut === "TERMINE" || workItem.statut === "ANNULE") throw new WorkItemTerminalError();

  const data: { titre?: string; description?: string | null } = {};
  if (params.titre !== undefined) {
    data.titre = titreNormalise(params.titre);
  }
  if (params.description !== undefined) {
    data.description = params.description;
  }

  return tx.workItem.update({ where: { id: params.workItemId }, data });
}

export async function modifierWorkItemAvecRetry(params: ModificationWorkItemParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => modifierWorkItem(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_WORK_ITEM_CONCURRENCE");
}

export type ParamsTransitionWorkItem = {
  workItemId: string;
  missionId: string;
  action: ActionLifecycleWorkItem;
  raison?: string; // "bloquer" — doit être l'une des RAISONS_BLOCAGE.
  raisonResolution?: string; // "debloquer" — justification libre, jamais vide.
  motif?: string; // "annuler" — jamais vide.
};

function texteNonVide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && valeur.trim().length > 0;
}

// COMPANY ATLAS — A23 : moteur de transition WorkItem.
//
// RÈGLE ABSOLUE (contrat A23 §12/§13/§34) : cette fonction n'écrit JAMAIS
// Mission.statut, MissionAssignment.statut ni MissionCapabilityLink.statut
// — les trois machines restent strictement indépendantes. Elle ne crée
// JAMAIS d'OutcomeAssessment/OutcomeEvidence (contrat A23 §37).
//
// CONCURRENCE (contrat A23 §31) : même technique que
// lib/mission/lifecycle.ts::executerTransitionMission — écriture
// conditionnelle en une seule instruction (`updateMany` avec le statut de
// départ observé en clause WHERE). Si une autre transition a changé le
// statut entre la lecture et cette écriture, `count === 0` et la
// transition est refusée (TRANSITION_INVALIDE) au lieu d'écraser un état
// plus récent — jamais une transaction Serializable + retry ici : une
// seule ligne est lue puis écrite, jamais plusieurs lignes agrégées (même
// justification que le précédent Mission lifecycle).
export async function executerTransitionWorkItem(params: ParamsTransitionWorkItem) {
  const workItem = await prisma.workItem.findUnique({ where: { id: params.workItemId } });
  if (!workItem || workItem.missionId !== params.missionId) throw new WorkItemIntrouvableError();

  const statutDepart = workItem.statut;
  const statutCible = CIBLE_PAR_ACTION[params.action];

  if (!transitionAutorisee(statutDepart, statutCible)) {
    throw new TransitionInvalideError(statutDepart, statutCible);
  }

  if (params.action === "bloquer") {
    if (!texteNonVide(params.raison)) throw new RaisonBlocageManquanteError();
    if (!estRaisonBlocageValide(params.raison)) throw new RaisonBlocageInvalideError();
  }

  if (params.action === "debloquer") {
    // Jamais la raison de blocage initiale réutilisée silencieusement
    // comme raison de résolution (contrat A23 §20) — un champ distinct,
    // toujours explicitement fourni.
    if (!texteNonVide(params.raisonResolution)) throw new RaisonResolutionManquanteError();
  }

  if (params.action === "annuler") {
    if (!texteNonVide(params.motif)) throw new MotifManquantError();
  }

  const ecriture = await prisma.workItem.updateMany({
    where: { id: params.workItemId, statut: statutDepart },
    data: { statut: statutCible },
  });
  if (ecriture.count === 0) {
    // Stale : un autre appelant a déjà transitionné ce WorkItem entre la
    // lecture ci-dessus et cette écriture — jamais un écrasement, jamais
    // un second gagnant (contrat A23 §31).
    throw new TransitionInvalideError(statutDepart, statutCible);
  }

  return prisma.workItem.findUniqueOrThrow({ where: { id: params.workItemId } });
}

export { RAISONS_BLOCAGE };
