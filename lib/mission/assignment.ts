import { Prisma } from "@prisma/client";
import type { MissionAssignmentRole, MissionAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A20 : MissionAssignment Foundation (05/10/2026).
//
// Service transactionnel pour MissionAssignment — jamais une validation
// uniquement applicative hors transaction (même discipline que
// lib/outcome/service.ts/lib/client-need/versioning.ts) : les deux
// invariants d'unicité (un seul responsable principal ACTIF par Mission,
// au plus un Assignment ACTIF par (Mission, Talent)) sont protégés par une
// transaction Serializable avec relecture DANS la transaction, jamais une
// vérification préalable suivie d'une écriture séparée.
//
// RBAC : contrôlé exclusivement par l'appelant (route API) — ce module ne
// vérifie jamais session.role lui-même, même discipline que
// lib/mission/need-pinning.ts.

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class TalentIntrouvableError extends Error {
  constructor() {
    super("TALENT_INTROUVABLE");
  }
}

export class AllocationInvalideError extends Error {
  constructor() {
    super("ALLOCATION_INVALIDE");
  }
}

export class DateIncoherenteError extends Error {
  constructor() {
    super("DATE_INCOHERENTE");
  }
}

export class StatutInitialInvalideError extends Error {
  constructor() {
    super("STATUT_INITIAL_INVALIDE");
  }
}

export class ResponsablePrincipalDejaPresentError extends Error {
  constructor() {
    super("RESPONSABLE_PRINCIPAL_DEJA_PRESENT");
  }
}

export class TalentDejaActifError extends Error {
  constructor() {
    super("TALENT_DEJA_ACTIF");
  }
}

export class AssignmentIntrouvableError extends Error {
  constructor() {
    super("ASSIGNMENT_INTROUVABLE");
  }
}

export class AssignmentNonActifError extends Error {
  constructor() {
    super("ASSIGNMENT_NON_ACTIF");
  }
}

export class AssignmentDejaTerminaleError extends Error {
  constructor() {
    super("ASSIGNMENT_DEJA_TERMINALE");
  }
}

// Statuts acceptés en création directe — jamais TERMINE/ANNULE (états
// atteints exclusivement via terminerAssignment/annulerAssignment, qui
// exigent dateFin). Le backfill historique (lib/mission/assignment-backfill.ts)
// contourne volontairement ce service pour ces deux statuts : il reconstruit
// un fait déjà réglé, il ne fait pas transiter un Assignment vivant.
const STATUTS_CREATION_AUTORISES: MissionAssignmentStatut[] = ["PLANIFIE", "ACTIF"];

function validerAllocation(allocationPct: number | null | undefined): number | null {
  if (allocationPct === undefined || allocationPct === null) return null;
  if (!Number.isInteger(allocationPct) || allocationPct < 0 || allocationPct > 100) {
    throw new AllocationInvalideError();
  }
  return allocationPct;
}

export type CreationAssignmentParams = {
  missionId: string;
  talentId: string;
  role: MissionAssignmentRole;
  statut?: MissionAssignmentStatut;
  dateDebut: Date;
  allocationPct?: number | null;
  estResponsablePrincipal?: boolean;
  createdByEmail: string;
};

async function creerAssignment(tx: Prisma.TransactionClient, params: CreationAssignmentParams) {
  const mission = await tx.mission.findUnique({ where: { id: params.missionId }, select: { id: true } });
  if (!mission) throw new MissionIntrouvableError();

  const talent = await tx.profil.findUnique({ where: { id: params.talentId }, select: { id: true } });
  if (!talent) throw new TalentIntrouvableError();

  const statut = params.statut ?? "ACTIF";
  if (!STATUTS_CREATION_AUTORISES.includes(statut)) throw new StatutInitialInvalideError();

  const allocationPct = validerAllocation(params.allocationPct);
  const estResponsablePrincipal = params.estResponsablePrincipal ?? false;

  // Relecture DANS la transaction (Serializable) — jamais une vérification
  // préalable hors transaction, qui laisserait une fenêtre de course entre
  // la lecture et l'écriture (même discipline que
  // creerOutcomeAssessment/executerForkAvecRetry).
  if (statut === "ACTIF") {
    if (estResponsablePrincipal) {
      const responsableExistant = await tx.missionAssignment.findFirst({
        where: { missionId: params.missionId, statut: "ACTIF", estResponsablePrincipal: true },
        select: { id: true },
      });
      if (responsableExistant) throw new ResponsablePrincipalDejaPresentError();
    }

    const memeTalentActif = await tx.missionAssignment.findFirst({
      where: { missionId: params.missionId, talentId: params.talentId, statut: "ACTIF" },
      select: { id: true },
    });
    if (memeTalentActif) throw new TalentDejaActifError();
  }

  return tx.missionAssignment.create({
    data: {
      missionId: params.missionId,
      talentId: params.talentId,
      role: params.role,
      statut,
      dateDebut: params.dateDebut,
      allocationPct,
      estResponsablePrincipal,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Même discipline que creerOutcomeAssessmentAvecRetry/executerForkAvecRetry :
// retry uniquement sur conflit de sérialisation Postgres (P2034).
export async function creerAssignmentAvecRetry(params: CreationAssignmentParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerAssignment(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_ASSIGNMENT_CONCURRENCE");
}

// Lecture seule.
export async function lireAssignment(assignmentId: string) {
  return prisma.missionAssignment.findUnique({ where: { id: assignmentId } });
}

export async function listerAssignmentsMission(missionId: string) {
  return prisma.missionAssignment.findMany({ where: { missionId }, orderBy: { createdAt: "asc" } });
}

export type TransitionAssignmentParams = {
  assignmentId: string;
  missionId: string; // revérifié ici en plus de l'appelant — même discipline que CreationOutcomeParams.clientId.
  dateFin: Date;
};

async function transitionnerAssignment(
  tx: Prisma.TransactionClient,
  params: TransitionAssignmentParams,
  nouveauStatut: "TERMINE" | "ANNULE"
) {
  const assignment = await tx.missionAssignment.findUnique({ where: { id: params.assignmentId } });
  if (!assignment || assignment.missionId !== params.missionId) throw new AssignmentIntrouvableError();
  if (assignment.statut === "TERMINE" || assignment.statut === "ANNULE") throw new AssignmentDejaTerminaleError();
  if (params.dateFin < assignment.dateDebut) throw new DateIncoherenteError();

  // A20 — DATE SEMANTICS CORRECTION (05/10/2026) : une transition vivante
  // fournit toujours un fait RÉEL (l'Admin saisit explicitement dateFin) —
  // dateFinProvenance=CONNUE, jamais une valeur PROXY (réservée au
  // backfill historique, lib/mission/assignment-backfill.ts).
  return tx.missionAssignment.update({
    where: { id: params.assignmentId },
    data: { statut: nouveauStatut, dateFin: params.dateFin, dateFinProvenance: "CONNUE" },
  });
}

export async function terminerAssignmentAvecRetry(params: TransitionAssignmentParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => transitionnerAssignment(tx, params, "TERMINE"), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_ASSIGNMENT_CONCURRENCE");
}

export async function annulerAssignmentAvecRetry(params: TransitionAssignmentParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => transitionnerAssignment(tx, params, "ANNULE"), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_ASSIGNMENT_CONCURRENCE");
}

export type ModificationAssignmentParams = {
  assignmentId: string;
  missionId: string;
  allocationPct?: number | null;
  estResponsablePrincipal?: boolean;
};

// Modifie allocationPct/estResponsablePrincipal — les SEULS champs
// modifiables après création (contrat A20 §8), et uniquement tant que
// l'Assignment est ACTIF. missionId/talentId/role/createdAt/createdByEmail
// ne sont jamais lus depuis params : aucun champ de ce type n'existe même
// dans cette signature, immutabilité garantie par construction du type,
// jamais seulement par une validation.
async function modifierAssignment(tx: Prisma.TransactionClient, params: ModificationAssignmentParams) {
  const assignment = await tx.missionAssignment.findUnique({ where: { id: params.assignmentId } });
  if (!assignment || assignment.missionId !== params.missionId) throw new AssignmentIntrouvableError();
  if (assignment.statut !== "ACTIF") throw new AssignmentNonActifError();

  const data: { allocationPct?: number | null; estResponsablePrincipal?: boolean } = {};

  if (params.allocationPct !== undefined) {
    data.allocationPct = validerAllocation(params.allocationPct);
  }

  if (params.estResponsablePrincipal !== undefined) {
    if (params.estResponsablePrincipal) {
      const responsableExistant = await tx.missionAssignment.findFirst({
        where: {
          missionId: params.missionId,
          statut: "ACTIF",
          estResponsablePrincipal: true,
          id: { not: params.assignmentId },
        },
        select: { id: true },
      });
      if (responsableExistant) throw new ResponsablePrincipalDejaPresentError();
    }
    data.estResponsablePrincipal = params.estResponsablePrincipal;
  }

  return tx.missionAssignment.update({ where: { id: params.assignmentId }, data });
}

export async function modifierAssignmentAvecRetry(params: ModificationAssignmentParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => modifierAssignment(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_ASSIGNMENT_CONCURRENCE");
}
