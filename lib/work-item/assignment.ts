import { Prisma } from "@prisma/client";
import type { WorkItemAssignmentRole, WorkItemAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WorkItemIntrouvableError, WorkItemTerminalError, MissionFermeeError, STATUTS_MISSION_FERMES } from "@/lib/work-item/lifecycle";

// COMPANY ATLAS — A24 : WorkItemAssignment Foundation (05/10/2026).
//
// Service transactionnel centralisant tous les invariants
// WorkItemAssignment — jamais dispersés dans les routes (même discipline
// que lib/mission/assignment.ts/lib/mission/capability-link.ts). Ce
// module ne vérifie jamais session.role lui-même, contrôlé exclusivement
// par l'appelant (route API).
//
// POURQUOI UN MODÈLE DE CONCURRENCE "A20/A21", PAS "A22/A23" (contrat A24
// §21/§45/§46) : contrairement à Mission/WorkItem (machines auto-
// suffisantes, où `updateMany` conditionnel sur UNE ligne suffit),
// WorkItemAssignment porte un invariant CROISÉ entre lignes ("au plus une
// ACTIF pour exactement le même (workItemId, missionAssignmentId)",
// contrat A24 §21) — structurellement identique au problème déjà résolu
// par A20 (un seul responsable principal ACTIF par Mission) et A21 (un
// seul lien ACTIF par (Mission, CapabilityRequirement)). Donc : même
// solution, Serializable + retry + relecture DANS la transaction, jamais
// une vérification préalable hors transaction suivie d'une écriture
// séparée — complétée par l'index unique partiel posé en migration
// (filet de sécurité ultime sous concurrence réelle, même doctrine A21).
//
// RÉUTILISE (jamais ne redéfinit) les erreurs/constantes déjà posées par
// A23 (WorkItemIntrouvableError/WorkItemTerminalError/MissionFermeeError/
// STATUTS_MISSION_FERMES) — un seul fait, une seule classe d'erreur, jamais
// une seconde définition divergente du même invariant Mission/WorkItem.

export class MissionAssignmentIntrouvableError extends Error {
  constructor() {
    super("MISSION_ASSIGNMENT_INTROUVABLE");
  }
}

export class WorkItemAssignmentIntrouvableError extends Error {
  constructor() {
    super("WORK_ITEM_ASSIGNMENT_INTROUVABLE");
  }
}

export class AssignmentDejaActifError extends Error {
  constructor() {
    super("ASSIGNMENT_DEJA_ACTIF");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: WorkItemAssignmentStatut, public readonly vers: WorkItemAssignmentStatut) {
    super("TRANSITION_INVALIDE");
  }
}

export class DateIncoherenteError extends Error {
  constructor() {
    super("DATE_INCOHERENTE");
  }
}

// Matrice de transitions explicite — même discipline que
// lib/work-item/lifecycle.ts::TRANSITIONS_AUTORISEES (contrat A24 §28) :
// une table pure, jamais un enchaînement de `if` dispersés.
export const TRANSITIONS_AUTORISEES: Record<WorkItemAssignmentStatut, WorkItemAssignmentStatut[]> = {
  PLANIFIE: ["ACTIF", "ANNULE"],
  ACTIF: ["TERMINE", "ANNULE"],
  TERMINE: [],
  ANNULE: [],
};

export function transitionAutorisee(depuis: WorkItemAssignmentStatut, vers: WorkItemAssignmentStatut): boolean {
  return TRANSITIONS_AUTORISEES[depuis].includes(vers);
}

export type ActionLifecycleWorkItemAssignment = "demarrer" | "terminer" | "annuler";

const CIBLE_PAR_ACTION: Record<ActionLifecycleWorkItemAssignment, WorkItemAssignmentStatut> = {
  demarrer: "ACTIF",
  terminer: "TERMINE",
  annuler: "ANNULE",
};

// AUCUN motif/raison obligatoire pour ces transitions (contrat A24 §32,
// décision explicite après audit) : le précédent architectural le plus
// proche — MissionAssignment/lib/mission/assignment.ts::
// transitionnerAssignment (A20), dont WorkItemAssignment est le pendant
// direct au niveau WorkItem — n'exige lui-même AUCUNE raison pour
// terminer/annuler une affectation (seule dateFin y est gérée). Mission
// (A22)/WorkItem (A23) exigent un motif parce qu'ils représentent une
// unité de TRAVAIL dont la clôture doit être expliquée ; une Assignment
// reste un simple fait d'affectation, comme son précédent A20 — jamais un
// second catalogue de raisons inventé sans un tel précédent.

function validerCoherenceDates(dateDebut: Date | null, dateFin: Date | null | undefined): void {
  if (dateFin != null && dateDebut != null && dateFin < dateDebut) {
    throw new DateIncoherenteError();
  }
}

export type CreationWorkItemAssignmentParams = {
  workItemId: string;
  missionAssignmentId: string;
  role: WorkItemAssignmentRole;
  dateDebut?: Date | null;
  createdByEmail: string;
};

// Précondition complète (contrat A24 §11), dans l'ordre : WorkItem
// existe -> WorkItem pas terminal -> Mission du WorkItem pas fermée ->
// MissionAssignment existe ET appartient à LA MÊME Mission (sinon
// EXACTEMENT la même erreur que "introuvable" — contrat A24 §9/§42,
// jamais une fuite d'existence IDOR).
async function creerWorkItemAssignment(tx: Prisma.TransactionClient, params: CreationWorkItemAssignmentParams) {
  const workItem = await tx.workItem.findUnique({ where: { id: params.workItemId }, select: { id: true, missionId: true, statut: true } });
  if (!workItem) throw new WorkItemIntrouvableError();
  if (workItem.statut === "TERMINE" || workItem.statut === "ANNULE") throw new WorkItemTerminalError();

  // Défensif — structurellement garanti par la FK WorkItem.missionId
  // (NOT NULL, ON DELETE CASCADE depuis Mission), mais jamais supposé
  // sans vérifier (même discipline que lib/mission/assignment-backfill.ts
  // vérifiant profilId malgré la contrainte NOT NULL).
  const mission = await tx.mission.findUnique({ where: { id: workItem.missionId }, select: { statut: true } });
  if (!mission) throw new WorkItemIntrouvableError();
  if (STATUTS_MISSION_FERMES.has(mission.statut)) throw new MissionFermeeError();

  const missionAssignment = await tx.missionAssignment.findUnique({ where: { id: params.missionAssignmentId }, select: { id: true, missionId: true } });
  if (!missionAssignment || missionAssignment.missionId !== workItem.missionId) {
    throw new MissionAssignmentIntrouvableError();
  }

  const dateDebut = params.dateDebut ?? null;

  return tx.workItemAssignment.create({
    data: {
      workItemId: params.workItemId,
      missionAssignmentId: params.missionAssignmentId,
      role: params.role,
      dateDebut,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

export async function creerWorkItemAssignmentAvecRetry(params: CreationWorkItemAssignmentParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerWorkItemAssignment(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_WORK_ITEM_ASSIGNMENT_CONCURRENCE");
}

export async function listerAssignmentsWorkItem(workItemId: string) {
  return prisma.workItemAssignment.findMany({ where: { workItemId }, orderBy: { createdAt: "asc" } });
}

export type LectureWorkItemAssignmentParams = {
  assignmentId: string;
  workItemId: string;
};

// Cross-check IDOR (contrat A24 §42) — même discipline que
// lib/work-item/lifecycle.ts::lireWorkItem : "introuvable" et "mauvais
// WorkItem parent" produisent EXACTEMENT la même erreur.
export async function lireWorkItemAssignment(params: LectureWorkItemAssignmentParams) {
  const assignment = await prisma.workItemAssignment.findUnique({ where: { id: params.assignmentId } });
  if (!assignment || assignment.workItemId !== params.workItemId) throw new WorkItemAssignmentIntrouvableError();
  return assignment;
}

export type ParamsTransitionWorkItemAssignment = {
  assignmentId: string;
  workItemId: string;
  action: ActionLifecycleWorkItemAssignment;
  dateFin?: Date | null; // "terminer"/"annuler" uniquement — jamais déduite, jamais "now()" implicite (contrat A24 §24).
};

// COMPANY ATLAS — A24 : moteur de transition WorkItemAssignment.
//
// RÈGLE ABSOLUE (contrat A24 §17/§18/§30/§31/§38) : cette fonction
// n'écrit JAMAIS WorkItem.statut, Mission.statut ni MissionAssignment.statut
// — les quatre machines (Mission/WorkItem/MissionAssignment/
// WorkItemAssignment) restent strictement indépendantes.
//
// CONCURRENCE (contrat A24 §21/§46) : Serializable + retry (voir
// rationale en tête de fichier) — la relecture ET l'écriture de CETTE
// ligne, PLUS la vérification applicative "aucune autre ligne déjà ACTIF
// pour ce (workItemId, missionAssignmentId)" quand la cible est ACTIF,
// se font DANS la même transaction. L'index unique partiel posé en
// migration reste le filet de sécurité ultime (traduit en
// AssignmentDejaActifError sur P2002).
async function transitionnerWorkItemAssignment(tx: Prisma.TransactionClient, params: ParamsTransitionWorkItemAssignment) {
  const assignment = await tx.workItemAssignment.findUnique({ where: { id: params.assignmentId } });
  if (!assignment || assignment.workItemId !== params.workItemId) throw new WorkItemAssignmentIntrouvableError();

  const statutDepart = assignment.statut;
  const statutCible = CIBLE_PAR_ACTION[params.action];

  if (!transitionAutorisee(statutDepart, statutCible)) {
    throw new TransitionInvalideError(statutDepart, statutCible);
  }

  if (statutCible === "ACTIF") {
    const dejaActif = await tx.workItemAssignment.findFirst({
      where: {
        workItemId: assignment.workItemId,
        missionAssignmentId: assignment.missionAssignmentId,
        statut: "ACTIF",
        id: { not: assignment.id },
      },
      select: { id: true },
    });
    if (dejaActif) throw new AssignmentDejaActifError();
  }

  const data: { statut: WorkItemAssignmentStatut; dateFin?: Date | null } = { statut: statutCible };
  if (params.action === "terminer" || params.action === "annuler") {
    const dateFin = params.dateFin ?? null;
    validerCoherenceDates(assignment.dateDebut, dateFin);
    if (dateFin !== null) data.dateFin = dateFin;
  }

  try {
    return await tx.workItemAssignment.update({ where: { id: params.assignmentId }, data });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      // Filet de sécurité ultime (index unique partiel) — une autre
      // transaction a gagné la course entre notre vérification
      // applicative ci-dessus et cette écriture.
      throw new AssignmentDejaActifError();
    }
    throw erreur;
  }
}

export async function executerTransitionWorkItemAssignmentAvecRetry(params: ParamsTransitionWorkItemAssignment) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => transitionnerWorkItemAssignment(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_WORK_ITEM_ASSIGNMENT_CONCURRENCE");
}
