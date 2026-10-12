import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.1, §3. Même discipline que lib/mission/assignment.ts : l'invariant
// d'unicité (au plus une CandidateSelection ACTIVE par shortlistEntreeId)
// est protégé par une transaction Serializable avec relecture DANS la
// transaction, jamais une vérification préalable suivie d'une écriture
// séparée, et jamais une contrainte DB (Prisma ne supporte pas un
// @@unique partiel nativement).
//
// RBAC : contrôlé exclusivement par l'appelant (route API) — ce module ne
// vérifie jamais session.role lui-même, même discipline que
// lib/mission/assignment.ts / lib/mission/need-pinning.ts.

export class ShortlistEntreeIntrouvableError extends Error {
  constructor() {
    super("SHORTLIST_ENTREE_INTROUVABLE");
  }
}

export class ShortlistEntreeNonValideeError extends Error {
  constructor() {
    super("SHORTLIST_ENTREE_NON_VALIDEE");
  }
}

export class SelectionDejaActiveError extends Error {
  constructor() {
    super("SELECTION_DEJA_ACTIVE");
  }
}

export class CandidateSelectionIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_SELECTION_INTROUVABLE");
  }
}

export class CandidateSelectionNonActiveError extends Error {
  constructor() {
    super("CANDIDATE_SELECTION_NON_ACTIVE");
  }
}

const MAX_TENTATIVES = 3;

export type CreationCandidateSelectionParams = {
  shortlistEntreeId: string;
  demandeTalentId: string; // revérifié ici en plus de l'appelant — même discipline que CreationAssignmentParams.missionId
  selectedByEmail: string;
};

async function creerCandidateSelection(tx: Prisma.TransactionClient, params: CreationCandidateSelectionParams) {
  const shortlistEntree = await tx.shortlistEntree.findUnique({
    where: { id: params.shortlistEntreeId },
    select: { id: true, demandeId: true, statut: true },
  });
  if (!shortlistEntree || shortlistEntree.demandeId !== params.demandeTalentId) {
    throw new ShortlistEntreeIntrouvableError();
  }
  if (shortlistEntree.statut !== "VALIDEE") {
    throw new ShortlistEntreeNonValideeError();
  }

  // Relecture DANS la transaction (Serializable) — jamais une vérification
  // préalable hors transaction, qui laisserait une fenêtre de course entre
  // la lecture et l'écriture (même discipline que creerAssignment).
  const selectionActiveExistante = await tx.candidateSelection.findFirst({
    where: { shortlistEntreeId: params.shortlistEntreeId, statut: "ACTIVE" },
    select: { id: true },
  });
  if (selectionActiveExistante) throw new SelectionDejaActiveError();

  return tx.candidateSelection.create({
    data: {
      shortlistEntreeId: params.shortlistEntreeId,
      demandeTalentId: params.demandeTalentId,
      selectedByEmail: params.selectedByEmail,
    },
  });
}

export async function creerCandidateSelectionAvecRetry(params: CreationCandidateSelectionParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerCandidateSelection(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_CANDIDATE_SELECTION_CONCURRENCE");
}

// Lecture seule.
export async function lireCandidateSelection(selectionId: string) {
  return prisma.candidateSelection.findUnique({ where: { id: selectionId } });
}

export async function listerCandidateSelectionsDemandeTalent(demandeTalentId: string) {
  return prisma.candidateSelection.findMany({ where: { demandeTalentId }, orderBy: { createdAt: "asc" } });
}

export type RetraitCandidateSelectionParams = {
  selectionId: string;
  demandeTalentId: string; // revérifié ici en plus de l'appelant
  retireeParEmail: string;
};

// ACTIVE -> RETIREE uniquement (jamais l'inverse — un regret crée une
// NOUVELLE CandidateSelection sur le même shortlistEntreeId, §1.1).
async function retirerCandidateSelection(tx: Prisma.TransactionClient, params: RetraitCandidateSelectionParams) {
  const selection = await tx.candidateSelection.findUnique({ where: { id: params.selectionId } });
  if (!selection || selection.demandeTalentId !== params.demandeTalentId) {
    throw new CandidateSelectionIntrouvableError();
  }
  if (selection.statut !== "ACTIVE") throw new CandidateSelectionNonActiveError();

  return tx.candidateSelection.update({
    where: { id: params.selectionId },
    data: { statut: "RETIREE", retireeParEmail: params.retireeParEmail, retireeLe: new Date() },
  });
}

export async function retirerCandidateSelectionAvecRetry(params: RetraitCandidateSelectionParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => retirerCandidateSelection(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_CANDIDATE_SELECTION_CONCURRENCE");
}
