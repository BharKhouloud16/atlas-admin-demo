import { Prisma } from "@prisma/client";
import type { DeliveryEvidenceMethod, DeliveryEvidenceConfidence } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A26 : DeliveryEvidence Foundation (05/10/2026).
//
// Service transactionnel centralisant TOUS les invariants DeliveryEvidence
// (contrat A26 §50) — résolution de cible, XOR, cohérence Mission,
// matrice méthode/confiance, immutabilité, succession, same-target,
// IDOR — jamais dispersés entre les deux routes (WorkItem/
// DeliverableVersion). Ce module ne vérifie jamais session.role lui-même
// (RBAC par méthode/rôle entièrement contrôlé par l'appelant — voir les
// routes), contrôlé exclusivement par l'appelant.
//
// DeliveryEvidence est un domaine FRÈRE de WorkItem/Deliverable sous
// Mission (même niveau architectural) — jamais une extension de l'un ou
// l'autre : définit ses propres erreurs plutôt que d'importer celles de
// lib/work-item/lifecycle.ts ou lib/deliverable/deliverable.ts (même
// discipline que Deliverable (A25) vs WorkItem (A23), MissionCapabilityLink
// (A21) vs MissionAssignment (A20)).

export class CibleIncoherenteError extends Error {
  constructor() {
    super("CIBLE_INCOHERENTE");
  }
}

// "Introuvable" et "cible d'une autre Mission que celle du contexte URL"
// produisent EXACTEMENT la même erreur — jamais une fuite d'existence
// IDOR (contrat A26 §9/§37/§46).
export class TargetIntrouvableError extends Error {
  constructor() {
    super("TARGET_INTROUVABLE");
  }
}

export class MethodeConfianceInvalideError extends Error {
  constructor() {
    super("METHODE_CONFIANCE_INVALIDE");
  }
}

export class ContenuInvalideError extends Error {
  constructor() {
    super("CONTENU_INVALIDE");
  }
}

// "Introuvable" et "appartient à une autre Mission" produisent la même
// erreur (contrat A26 §43) — jamais une fuite d'existence.
export class EvidenceIntrouvableError extends Error {
  constructor() {
    super("EVIDENCE_INTROUVABLE");
  }
}

// Même Mission mais cible différente (contrat A26 §42) — visible, jamais
// un secret : 409, pas 404.
export class CibleDifferenteError extends Error {
  constructor() {
    super("CIBLE_DIFFERENTE");
  }
}

export class DejaSupersedeError extends Error {
  constructor() {
    super("DEJA_SUPERSEDE");
  }
}

// Matrice méthode -> {confiances autorisées, défaut} — VERROUILLÉE
// (contrat A26 §12), jamais une combinaison arbitraire. Une table pure,
// jamais un enchaînement de `if` dispersés (même discipline que
// lib/mission/lifecycle.ts::TRANSITIONS_AUTORISEES).
export const MATRICE_CONFIANCE: Record<DeliveryEvidenceMethod, { autorisees: DeliveryEvidenceConfidence[]; defaut: DeliveryEvidenceConfidence }> = {
  DECLARATION_TALENT: { autorisees: ["DECLARE", "INCONNU"], defaut: "DECLARE" },
  VALIDATION_ADMIN: { autorisees: ["VERIFIE", "DECLARE"], defaut: "VERIFIE" },
  VALIDATION_CLIENT: { autorisees: ["DECLARE"], defaut: "DECLARE" },
  MESURE_SYSTEME: { autorisees: ["VERIFIE", "DECLARE"], defaut: "DECLARE" },
  TEST_AUTOMATISE: { autorisees: ["VERIFIE", "DECLARE"], defaut: "VERIFIE" },
  INFERENCE_IA: { autorisees: ["INFERE"], defaut: "INFERE" },
};

// RÈGLE CRITIQUE (contrat A26 §13) : une Evidence INFERENCE_IA/INFERE ne
// peut JAMAIS être promue silencieusement en VERIFIE — cette fonction ne
// fait QUE valider la combinaison (méthode, confiance) D'UNE SEULE ligne à
// la création ; la "promotion" n'existe pas comme opération, seule la
// création d'une NOUVELLE Evidence (méthode VALIDATION_ADMIN/VERIFIE,
// supersedesId = l'ancienne) peut documenter une vérification ultérieure
// — l'ancienne reste exactement ce qu'elle était (contrat A26 §13/§17).
export function validerConfiance(methode: DeliveryEvidenceMethod, confiance: unknown): DeliveryEvidenceConfidence {
  const regle = MATRICE_CONFIANCE[methode];
  if (confiance === undefined || confiance === null) return regle.defaut;
  if (typeof confiance !== "string" || !regle.autorisees.includes(confiance as DeliveryEvidenceConfidence)) {
    throw new MethodeConfianceInvalideError();
  }
  return confiance as DeliveryEvidenceConfidence;
}

function contenuNormalise(contenu: unknown): string {
  if (typeof contenu !== "string") throw new ContenuInvalideError();
  const normalise = contenu.trim();
  if (normalise.length === 0) throw new ContenuInvalideError();
  return normalise;
}

export type CibleParams = {
  workItemId?: string | null;
  deliverableVersionId?: string | null;
};

type CibleResolue = { workItemId: string | null; deliverableVersionId: string | null };

// XOR strict (contrat A26 §6) : exactement l'un des deux, jamais les
// deux, jamais aucun. Puis cohérence de Mission (contrat A26 §8/§9) :
// WorkItem -> Mission directe ; DeliverableVersion -> Deliverable ->
// Mission — jamais une relation croisée artificielle.
async function resoudreCible(tx: Prisma.TransactionClient, cible: CibleParams, missionIdAttendu: string): Promise<CibleResolue> {
  const aWorkItem = cible.workItemId !== undefined && cible.workItemId !== null;
  const aDeliverableVersion = cible.deliverableVersionId !== undefined && cible.deliverableVersionId !== null;

  if (aWorkItem === aDeliverableVersion) {
    // Soit les deux fournis, soit aucun — refusé dans les deux cas.
    throw new CibleIncoherenteError();
  }

  if (aWorkItem) {
    const workItem = await tx.workItem.findUnique({ where: { id: cible.workItemId! }, select: { id: true, missionId: true } });
    if (!workItem || workItem.missionId !== missionIdAttendu) throw new TargetIntrouvableError();
    return { workItemId: workItem.id, deliverableVersionId: null };
  }

  const version = await tx.deliverableVersion.findUnique({ where: { id: cible.deliverableVersionId! }, select: { id: true, deliverableId: true } });
  if (!version) throw new TargetIntrouvableError();
  const deliverable = await tx.deliverable.findUnique({ where: { id: version.deliverableId }, select: { missionId: true } });
  if (!deliverable || deliverable.missionId !== missionIdAttendu) throw new TargetIntrouvableError();
  return { workItemId: null, deliverableVersionId: version.id };
}

// Résout la Mission d'UNE Evidence existante via SA PROPRE cible — jamais
// supposée égale à une Mission fournie par l'appelant sans vérifier
// (contrat A26 §43).
async function resoudreMissionDeEvidence(tx: Prisma.TransactionClient, evidence: { workItemId: string | null; deliverableVersionId: string | null }): Promise<string | null> {
  if (evidence.workItemId) {
    const workItem = await tx.workItem.findUnique({ where: { id: evidence.workItemId }, select: { missionId: true } });
    return workItem?.missionId ?? null;
  }
  if (evidence.deliverableVersionId) {
    const version = await tx.deliverableVersion.findUnique({ where: { id: evidence.deliverableVersionId }, select: { deliverableId: true } });
    if (!version) return null;
    const deliverable = await tx.deliverable.findUnique({ where: { id: version.deliverableId }, select: { missionId: true } });
    return deliverable?.missionId ?? null;
  }
  return null;
}

export type CreationEvidenceParams = CibleParams & {
  missionId: string; // Mission du contexte URL — jamais déduite, toujours fournie par l'appelant.
  methode: DeliveryEvidenceMethod;
  confiance?: unknown;
  contenu: string;
  supersedesId?: string | null;
  createdByEmail: string;
};

// COMPANY ATLAS — A26 : création d'une DeliveryEvidence.
//
// AUCUNE vérification Mission.statut / WorkItem.statut / DeliverableVersion.
// statut ici (contrat A26 §24/§26/§27/§38/§39/§40, décision explicite) :
// "TERMINEE/ANNULE bloquent le travail futur, jamais la collecte de preuve
// historique" — même doctrine que les nouvelles versions de Deliverable
// (A25 §34/§35), étendue ici à TOUS les états cibles sans exception : une
// Evidence peut être créée sur un WorkItem ou une Mission dans N'IMPORTE
// QUEL état, y compris terminal.
async function creerEvidence(tx: Prisma.TransactionClient, params: CreationEvidenceParams) {
  const cible = await resoudreCible(tx, params, params.missionId);
  const confiance = validerConfiance(params.methode, params.confiance);
  const contenu = contenuNormalise(params.contenu);

  let supersedesId: string | null = null;
  if (params.supersedesId) {
    const ancienne = await tx.deliveryEvidence.findUnique({ where: { id: params.supersedesId } });
    if (!ancienne) throw new EvidenceIntrouvableError();

    // Cross-Mission (contrat A26 §43) : résoudre la Mission de l'ancienne
    // via SA PROPRE cible, jamais supposer qu'elle correspond à
    // params.missionId — si différente ou introuvable, uniforme
    // "introuvable", jamais une fuite d'existence.
    const missionAncienne = await resoudreMissionDeEvidence(tx, { workItemId: ancienne.workItemId, deliverableVersionId: ancienne.deliverableVersionId });
    if (!missionAncienne || missionAncienne !== params.missionId) throw new EvidenceIntrouvableError();

    // Cross-target (contrat A26 §42) : même Mission, mais cible
    // différente -> 409 visible (pas un secret).
    if (ancienne.workItemId !== cible.workItemId || ancienne.deliverableVersionId !== cible.deliverableVersionId) {
      throw new CibleDifferenteError();
    }

    // Déjà supersédée ? Pré-vérification applicative avant l'écriture
    // (contrat A26 §44) — le filet de sécurité ultime reste l'index
    // unique sur supersedesId, traduit en P2002 par l'appelant retry.
    const dejaSupersedee = await tx.deliveryEvidence.findFirst({ where: { supersedesId: params.supersedesId }, select: { id: true } });
    if (dejaSupersedee) throw new DejaSupersedeError();

    supersedesId = params.supersedesId;
  }

  return tx.deliveryEvidence.create({
    data: {
      workItemId: cible.workItemId,
      deliverableVersionId: cible.deliverableVersionId,
      methode: params.methode,
      confiance,
      contenu,
      supersedesId,
      createdByEmail: params.createdByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Serializable + retry (P2034) + traduction P2002 (contrat A26 §45) —
// même discipline que lib/mission/capability-link.ts::creerLienAvecRetry /
// lib/deliverable/work-item-link.ts::creerLienAvecRetry : le filet de
// sécurité ultime sous concurrence réelle reste l'index unique sur
// supersedesId, jamais seulement la pré-vérification applicative.
export async function creerEvidenceAvecRetry(params: CreationEvidenceParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerEvidence(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") throw new DejaSupersedeError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_DELIVERY_EVIDENCE_CONCURRENCE");
}

export async function listerEvidencesWorkItem(workItemId: string) {
  return prisma.deliveryEvidence.findMany({ where: { workItemId }, orderBy: { createdAt: "asc" } });
}

export async function listerEvidencesDeliverableVersion(deliverableVersionId: string) {
  return prisma.deliveryEvidence.findMany({ where: { deliverableVersionId }, orderBy: { createdAt: "asc" } });
}
