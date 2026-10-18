import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A21 : MissionCapabilityLink (05/10/2026).
//
// Service transactionnel centralisant tous les invariants du lien
// Mission <-> CapabilityRequirement — jamais dispersés dans les routes
// (même discipline que lib/mission/assignment.ts/lib/mission/
// need-pinning.ts). Ce module ne vérifie jamais session.role lui-même,
// contrôlé exclusivement par l'appelant (route API).
//
// RÈGLE : aucune incohérence (version de Need, SolutionDecision, tenant)
// n'est jamais corrigée silencieusement — toute incohérence produit une
// erreur métier explicite, à charge de l'appelant de la traduire en
// 400/404/409 approprié.

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class CapabilityRequirementIntrouvableError extends Error {
  constructor() {
    super("CAPABILITY_REQUIREMENT_INTROUVABLE");
  }
}

export class NeedVersionIncoherenteError extends Error {
  constructor() {
    super("NEED_VERSION_INCOHERENTE");
  }
}

export class SolutionDecisionIncoherenteError extends Error {
  constructor() {
    super("SOLUTION_DECISION_INCOHERENTE");
  }
}

export class CapaciteManuelleManquanteError extends Error {
  constructor() {
    super("CAPACITE_MANUELLE_MANQUANTE");
  }
}

export class LienDejaActifError extends Error {
  constructor() {
    super("LIEN_DEJA_ACTIF");
  }
}

export class LienIntrouvableError extends Error {
  constructor() {
    super("LIEN_INTROUVABLE");
  }
}

export class LienDejaSupersedeError extends Error {
  constructor() {
    super("LIEN_DEJA_SUPERSEDE");
  }
}

// Deux formes mutuellement exclusives, imposées par le type lui-même —
// jamais un `capability` fourni par l'appelant qui serait silencieusement
// ignoré/écrasé quand capabilityRequirementId est présent (contrat A21
// §8 : le snapshot ne provient QUE de la CapabilityRequirement référencée
// dans ce cas, jamais d'une valeur concurrente).
export type CreationLienParams = {
  missionId: string;
  rationale?: string | null;
  createdByEmail: string;
} & ({ capabilityRequirementId: string; capability?: undefined } | { capabilityRequirementId?: null; capability: string });

function estLienManuel(params: CreationLienParams): params is CreationLienParams & { capabilityRequirementId?: null; capability: string } {
  return !params.capabilityRequirementId;
}

type ClientDb = Prisma.TransactionClient | typeof prisma;

async function creerLien(tx: ClientDb, params: CreationLienParams) {
  const mission = await tx.mission.findUnique({
    where: { id: params.missionId },
    select: { id: true, clientId: true, needVersionId: true, solutionDecisionId: true },
  });
  if (!mission) throw new MissionIntrouvableError();

  if (params.capabilityRequirementId) {
    const requirement = await tx.capabilityRequirement.findUnique({
      where: { id: params.capabilityRequirementId },
      select: {
        id: true,
        needVersionId: true,
        solutionDecisionId: true,
        requiredCapability: true,
        need: { select: { clientId: true } },
      },
    });
    // IDOR : "introuvable" et "mauvais tenant" produisent EXACTEMENT la
    // même erreur — même discipline que NeedIntrouvableError (A18) et
    // MissionIntrouvableError (A6.1) : jamais révéler l'existence d'une
    // CapabilityRequirement appartenant à un autre client.
    if (!requirement || requirement.need.clientId !== mission.clientId) {
      throw new CapabilityRequirementIntrouvableError();
    }

    // Cohérence de version (contrat A21 §6) : une Mission sans
    // needVersionId ne peut recevoir qu'un lien MANUEL — jamais une
    // CapabilityRequirement "flottante" sans pin Need vérifiable. Une
    // Mission pinnée sur une AUTRE version que celle de la
    // CapabilityRequirement est refusée — jamais une substitution
    // silencieuse par la version courante.
    if (!mission.needVersionId || mission.needVersionId !== requirement.needVersionId) {
      throw new NeedVersionIncoherenteError();
    }

    // Cohérence SolutionDecision (contrat A21 §7) : vérifiée UNIQUEMENT
    // quand les deux valeurs sont renseignées (même symétrie que
    // lib/mission/need-pinning.ts) — une CapabilityRequirement sans
    // solutionDecisionId n'est jamais un conflit.
    if (mission.solutionDecisionId && requirement.solutionDecisionId && mission.solutionDecisionId !== requirement.solutionDecisionId) {
      throw new SolutionDecisionIncoherenteError();
    }

    // Unicité "un seul lien ACTIF par (Mission, CapabilityRequirement)" —
    // relecture DANS la transaction en complément de l'index unique
    // partiel DB (contrat A21 §12) : donne une erreur métier propre avant
    // même de tenter l'écriture, l'index reste le filet de sécurité ultime
    // sous concurrence réelle (voir creerLienAvecRetry).
    const dejaActif = await tx.missionCapabilityLink.findFirst({
      where: { missionId: params.missionId, capabilityRequirementId: params.capabilityRequirementId, statut: "ACTIVE" },
      select: { id: true },
    });
    if (dejaActif) throw new LienDejaActifError();

    return tx.missionCapabilityLink.create({
      data: {
        missionId: params.missionId,
        capabilityRequirementId: params.capabilityRequirementId,
        capability: requirement.requiredCapability,
        rationale: params.rationale ?? null,
        createdByEmail: params.createdByEmail,
      },
    });
  }

  // Lien manuel — aucune CapabilityRequirement, aucune vérification de
  // cohérence Need/SolutionDecision (rien à comparer). `capability` est
  // alors obligatoire et jamais déduit.
  if (!estLienManuel(params)) throw new CapaciteManuelleManquanteError();
  const capaciteTexte = params.capability.trim();
  if (capaciteTexte.length === 0) throw new CapaciteManuelleManquanteError();

  // Dédoublonnage des liens manuels — pas de clé naturelle DB (texte
  // libre), donc purement applicatif ici : un même texte normalisé
  // (trim + casse) déjà ACTIF sur cette Mission est refusé, jamais
  // dupliqué silencieusement.
  const doublonManuel = await tx.missionCapabilityLink.findFirst({
    where: {
      missionId: params.missionId,
      capabilityRequirementId: null,
      statut: "ACTIVE",
      capability: { equals: capaciteTexte, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (doublonManuel) throw new LienDejaActifError();

  return tx.missionCapabilityLink.create({
    data: {
      missionId: params.missionId,
      capabilityRequirementId: null,
      capability: capaciteTexte,
      rationale: params.rationale ?? null,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Même discipline que creerAssignmentAvecRetry/creerOutcomeAssessmentAvecRetry :
// Serializable + retry sur conflit de sérialisation (P2034). Une violation
// de l'index unique partiel (P2002, concurrence réelle gagnée par un autre
// appelant) est traduite en la même erreur métier que la vérification
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
        if (erreur.code === "P2002") throw new LienDejaActifError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_LIEN_CONCURRENCE");
}

export async function lireLiensMission(missionId: string) {
  return prisma.missionCapabilityLink.findMany({ where: { missionId }, orderBy: { createdAt: "asc" } });
}

export type SupersederLienParams = {
  linkId: string;
  missionId: string;
};

async function superseder(tx: ClientDb, params: SupersederLienParams) {
  const lien = await tx.missionCapabilityLink.findUnique({ where: { id: params.linkId } });
  if (!lien || lien.missionId !== params.missionId) throw new LienIntrouvableError();
  if (lien.statut === "SUPERSEDED") throw new LienDejaSupersedeError();

  return tx.missionCapabilityLink.update({ where: { id: params.linkId }, data: { statut: "SUPERSEDED" } });
}

export async function supersederLienAvecRetry(params: SupersederLienParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => superseder(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_LIEN_CONCURRENCE");
}
