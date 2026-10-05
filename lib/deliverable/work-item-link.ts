import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DeliverableIntrouvableError } from "@/lib/deliverable/deliverable";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026) — DeliverableWorkItemLink.
//
// Lien N:M EXPLICITE entre Deliverable et WorkItem — jamais créé
// automatiquement (contrat A25 §22/§23). Volontairement au niveau
// Deliverable, JAMAIS DeliverableVersion (contrat A25 §25/§26) : les
// WorkItems contributeurs restent les mêmes à travers les révisions,
// jamais dupliqués à chaque nouvelle version.
//
// AUCUNE restriction de statut Mission ni WorkItem sur ce chemin (décision
// explicite, documentée ici) : un lien est une action de TRAÇABILITÉ
// (quels WorkItems ont contribué à ce Deliverable), jamais "du nouveau
// travail" au sens du contrat A25 §33/§34 — un Deliverable se lie
// couramment à des WorkItem déjà TERMINE (le travail qui a produit ce
// livrable est, par construction, souvent déjà achevé). Ni Mission.statut
// ni WorkItem.statut ne sont donc jamais vérifiés ici.

export class WorkItemIncoherentError extends Error {
  constructor() {
    super("WORK_ITEM_INCOHERENT");
  }
}

export class LienDejaExistantError extends Error {
  constructor() {
    super("LIEN_DEJA_EXISTANT");
  }
}

export class LienIntrouvableError extends Error {
  constructor() {
    super("LIEN_INTROUVABLE");
  }
}

export type CreationLienParams = {
  deliverableId: string;
  workItemId: string;
  createdByEmail: string;
};

// COHÉRENCE DE MISSION (contrat A25 §24/§46) : Deliverable.missionId ==
// WorkItem.missionId — "introuvable" et "mauvaise Mission" produisent
// EXACTEMENT la même erreur (WorkItemIncoherentError), jamais une fuite
// d'existence IDOR.
async function creerLien(tx: Prisma.TransactionClient, params: CreationLienParams) {
  const deliverable = await tx.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable) throw new DeliverableIntrouvableError();

  const workItem = await tx.workItem.findUnique({ where: { id: params.workItemId }, select: { id: true, missionId: true } });
  if (!workItem || workItem.missionId !== deliverable.missionId) throw new WorkItemIncoherentError();

  const dejaExistant = await tx.deliverableWorkItemLink.findFirst({
    where: { deliverableId: params.deliverableId, workItemId: params.workItemId },
    select: { id: true },
  });
  if (dejaExistant) throw new LienDejaExistantError();

  return tx.deliverableWorkItemLink.create({
    data: {
      deliverableId: params.deliverableId,
      workItemId: params.workItemId,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Même discipline que lib/mission/capability-link.ts::creerLienAvecRetry :
// Serializable + retry, violation de l'index unique (P2002, concurrence
// réelle) traduite en la même erreur métier que la vérification
// applicative — jamais une 500 brute exposée à l'appelant.
export async function creerLienAvecRetry(params: CreationLienParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerLien(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") throw new LienDejaExistantError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_LIEN_CONCURRENCE");
}

export async function listerLiensDeliverable(deliverableId: string) {
  return prisma.deliverableWorkItemLink.findMany({ where: { deliverableId }, orderBy: { createdAt: "asc" } });
}

export type SuppressionLienParams = {
  deliverableId: string;
  workItemId: string;
};

// Suppression = hard delete (contrat A25 §44, verbe DELETE) — jamais un
// soft-SUPERSEDED : ce lien ne porte lui-même aucun fait métier à
// historiser, seul un pointeur de traçabilité. Ni le Deliverable ni le
// WorkItem ne sont jamais supprimés par ce retrait (onDelete du FK
// WorkItem reste Restrict, inchangé — seule CETTE ligne de jointure
// disparaît).
export async function supprimerLien(params: SuppressionLienParams) {
  const lien = await prisma.deliverableWorkItemLink.findFirst({
    where: { deliverableId: params.deliverableId, workItemId: params.workItemId },
  });
  if (!lien) throw new LienIntrouvableError();

  await prisma.deliverableWorkItemLink.delete({ where: { id: lien.id } });
  return lien;
}
