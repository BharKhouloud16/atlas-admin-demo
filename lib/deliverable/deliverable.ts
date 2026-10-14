import { Prisma } from "@prisma/client";
import type { DeliverableNatureContenu } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// Service transactionnel centralisant les invariants Deliverable (objet
// logique) — jamais dispersés dans les routes (même discipline que
// lib/mission/capability-link.ts/lib/work-item/lifecycle.ts). Ce module
// ne vérifie jamais session.role lui-même, contrôlé exclusivement par
// l'appelant (route API).
//
// Redéfinit sa PROPRE règle "TERMINEE/ANNULEE gèlent la création de
// nouveau travail" plutôt que d'importer celle de lib/work-item/
// lifecycle.ts : Deliverable est un domaine FRÈRE de WorkItem sous
// Mission (même niveau architectural), pas une extension de WorkItem —
// même discipline que MissionCapabilityLink (A21) définissant sa propre
// MissionIntrouvableError plutôt que d'importer celle de lib/mission/
// assignment.ts (A20).

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

// Création d'un nouveau Deliverable refusée sur une Mission close (contrat
// A25 §33) — "TERMINEE freezes new work, not evaluation/conformité" :
// même doctrine que WorkItem (A23)/WorkItemAssignment (A24). NE s'applique
// QUE sur ce chemin (création d'un Deliverable) — jamais sur la création
// d'une nouvelle VERSION d'un Deliverable déjà existant (contrat A25
// §34/§35, décision explicite documentée dans lib/deliverable/version.ts :
// une correction/version corrective après TERMINEE/ANNULEE reste
// toujours autorisée, c'est historiquement nécessaire à l'évaluation, ce
// n'est jamais "du nouveau travail").
export class MissionFermeeError extends Error {
  constructor() {
    super("MISSION_FERMEE");
  }
}

export const STATUTS_MISSION_FERMES = new Set(["TERMINEE", "ANNULEE"]);

export class TitreInvalideError extends Error {
  constructor() {
    super("TITRE_INVALIDE");
  }
}

// Incohérence nature/contenuStructure (contrat A25 §8/§37) : contenuStructure
// n'est acceptée QUE si natureContenu = STRUCTURE — jamais ignorée
// silencieusement dans l'autre sens.
export class ContenuStructureInvalideError extends Error {
  constructor() {
    super("CONTENU_STRUCTURE_INVALIDE");
  }
}

export class DeliverableIntrouvableError extends Error {
  constructor() {
    super("DELIVERABLE_INTROUVABLE");
  }
}

function titreNormalise(titre: unknown): string {
  if (typeof titre !== "string") throw new TitreInvalideError();
  const normalise = titre.trim();
  if (normalise.length === 0) throw new TitreInvalideError();
  return normalise;
}

// Cohérence nature <-> contenuStructure, dans les deux sens (contrat A25
// §8/§37) — jamais une incohérence corrigée silencieusement.
export function validerContenuStructure(natureContenu: DeliverableNatureContenu, contenuStructure: unknown): Prisma.InputJsonValue | null {
  if (natureContenu === "STRUCTURE") {
    if (contenuStructure === undefined || contenuStructure === null) return null;
    return contenuStructure as Prisma.InputJsonValue;
  }
  if (contenuStructure !== undefined && contenuStructure !== null) {
    throw new ContenuStructureInvalideError();
  }
  return null;
}

export type CreationDeliverableParams = {
  missionId: string;
  titre: string;
  natureContenu: DeliverableNatureContenu;
  acceptanceCriteria?: string | null;
  contenuStructure?: unknown;
  createdByEmail: string;
};

// Création ATOMIQUE Deliverable + sa première version V1 (contrat A25
// §38 : "le système doit garantir qu'un Deliverable exploitable possède
// une première version", jamais une histoire de version ambiguë) — une
// seule transaction, jamais un Deliverable sans aucune version.
async function creerDeliverable(tx: Prisma.TransactionClient, params: CreationDeliverableParams) {
  const mission = await tx.mission.findUnique({ where: { id: params.missionId }, select: { id: true, statut: true } });
  if (!mission) throw new MissionIntrouvableError();
  if (STATUTS_MISSION_FERMES.has(mission.statut)) throw new MissionFermeeError();

  const titre = titreNormalise(params.titre);
  const contenuStructure = validerContenuStructure(params.natureContenu, params.contenuStructure);
  const acceptanceCriteria = params.acceptanceCriteria === undefined || params.acceptanceCriteria === null ? null : params.acceptanceCriteria;

  return tx.deliverable.create({
    data: {
      missionId: params.missionId,
      acceptanceCriteria,
      createdByEmail: params.createdByEmail,
      versions: {
        create: {
          version: 1,
          titre,
          natureContenu: params.natureContenu,
          contenuStructure: contenuStructure ?? Prisma.JsonNull,
          createdByEmail: params.createdByEmail,
        },
      },
    },
    include: { versions: true },
  });
}

const MAX_TENTATIVES = 3;

// Serializable + retry (même discipline que creerAssignmentAvecRetry/
// creerLienAvecRetry) : protège la vérification "Mission pas fermée"
// d'une course avec une transition Mission concurrente — jamais une
// vérification préalable hors transaction suivie d'une écriture séparée.
export async function creerDeliverableAvecRetry(params: CreationDeliverableParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerDeliverable(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_DELIVERABLE_CONCURRENCE");
}

export async function listerDeliverablesMission(missionId: string) {
  return prisma.deliverable.findMany({
    where: { missionId },
    orderBy: { createdAt: "asc" },
    include: { versions: { orderBy: { version: "asc" } } },
  });
}

export type LectureDeliverableParams = {
  deliverableId: string;
  missionId: string;
};

// Cross-check IDOR (contrat A25 §46) — même discipline que
// lib/work-item/lifecycle.ts::lireWorkItem : "introuvable" et "mauvaise
// Mission parente" produisent EXACTEMENT la même erreur.
export async function lireDeliverable(params: LectureDeliverableParams) {
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: params.deliverableId },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  if (!deliverable || deliverable.missionId !== params.missionId) throw new DeliverableIntrouvableError();
  return deliverable;
}

export type ModificationDeliverableParams = {
  deliverableId: string;
  missionId: string;
  acceptanceCriteria?: string | null;
};

// acceptanceCriteria est le SEUL champ modifiable sur Deliverable après
// création (contrat A25 §27/§39 : les autres champs métier vivent sur
// DeliverableVersion). Jamais gelé par le lifecycle de version — un
// contrat d'acceptation reste éditable indépendamment du statut de la
// version courante (décision explicite, non testée en terminal faute de
// justification contraire dans le mandat).
async function modifierDeliverable(tx: Prisma.TransactionClient, params: ModificationDeliverableParams) {
  const deliverable = await tx.deliverable.findUnique({ where: { id: params.deliverableId } });
  if (!deliverable || deliverable.missionId !== params.missionId) throw new DeliverableIntrouvableError();

  const data: { acceptanceCriteria?: string | null } = {};
  if (params.acceptanceCriteria !== undefined) {
    data.acceptanceCriteria = params.acceptanceCriteria;
  }

  return tx.deliverable.update({ where: { id: params.deliverableId }, data });
}

export async function modifierDeliverableAvecRetry(params: ModificationDeliverableParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => modifierDeliverable(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_DELIVERABLE_CONCURRENCE");
}
