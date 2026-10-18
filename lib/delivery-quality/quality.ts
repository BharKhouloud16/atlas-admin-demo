import { Prisma } from "@prisma/client";
import type { DeliveryQualityResult, DeliveryQualityStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// Service centralisant TOUS les invariants DeliveryQualityGate (cible,
// cohérence Mission, snapshot acceptanceCriteria, lifecycle, liens
// Evidence, IDOR) — jamais dispersés entre les routes (contrat A27
// §43/§44). Ce module ne vérifie JAMAIS session.role lui-même (RBAC
// entièrement contrôlé par l'appelant — voir les routes), même
// discipline que lib/delivery-evidence/evidence.ts (A26).
//
// Chemin DÉLIBÉRÉMENT `lib/delivery-quality/`, jamais `lib/quality/` —
// ce dernier répertoire existe déjà et porte un domaine totalement
// SANS RAPPORT (Quality Signals CI/Sécurité dérivés de GitHub Actions/
// code review, voir lib/quality/domain.ts::QualityObservation/
// QualityStatus, bounded context distinct, confirmé par l'audit A27 §4)
// — réutiliser ce répertoire aurait risqué une collision de nom
// (evidence.ts y existe déjà pour un usage différent). Même préfixe
// `Delivery` que DeliveryEvidence (A26), jamais le même répertoire.
//
// Domaine FRÈRE de DeliveryEvidence/Deliverable/WorkItem sous Mission —
// définit ses propres erreurs plutôt que d'importer celles des domaines
// voisins (même discipline que A25 vs A23, A26 vs A23/A25).

export class DeliverableVersionIntrouvableError extends Error {
  constructor() {
    super("DELIVERABLE_VERSION_INTROUVABLE");
  }
}

export class CriteresInvalidesError extends Error {
  constructor() {
    super("CRITERES_INVALIDES");
  }
}

export class ResultatInvalideError extends Error {
  constructor() {
    super("RESULTAT_INVALIDE");
  }
}

// "Introuvable" et "appartient à une autre Mission" produisent
// EXACTEMENT la même erreur — jamais une fuite d'existence IDOR (même
// doctrine que A26 §9/§37/§46).
export class QualityGateIntrouvableError extends Error {
  constructor() {
    super("QUALITY_GATE_INTROUVABLE");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: DeliveryQualityStatut, public readonly vers: DeliveryQualityStatut) {
    super("TRANSITION_INVALIDE");
  }
}

// Une fois FINALIZED, plus aucune écriture n'est permise — ni le contenu
// (criteresEvalues/resultat), ni les liens Evidence (contrat A27 §17-20,
// même doctrine que DeliverableVersion FINALIZED, A25 §18).
export class QualityGateFinaliseeError extends Error {
  constructor() {
    super("QUALITY_GATE_FINALISEE");
  }
}

export class DeliveryEvidenceIntrouvableError extends Error {
  constructor() {
    super("DELIVERY_EVIDENCE_INTROUVABLE");
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

const RESULTATS_VALIDES: DeliveryQualityResult[] = ["PASS", "FAIL", "NOT_DETERMINABLE"];

export function validerResultat(valeur: unknown): DeliveryQualityResult {
  if (typeof valeur !== "string" || !RESULTATS_VALIDES.includes(valeur as DeliveryQualityResult)) {
    throw new ResultatInvalideError();
  }
  return valeur as DeliveryQualityResult;
}

function criteresNormalises(valeur: unknown): string {
  if (typeof valeur !== "string") throw new CriteresInvalidesError();
  const normalise = valeur.trim();
  if (normalise.length === 0) throw new CriteresInvalidesError();
  return normalise;
}

export type CreationQualityGateParams = {
  missionId: string; // Mission du contexte URL — jamais déduite.
  deliverableVersionId: string;
  criteresEvalues: string;
  resultat: unknown;
  evaluatedByEmail: string;
  evaluatedByRole: string;
  createdByEmail: string;
};

// AUCUNE vérification Mission.statut / DeliverableVersion.statut ici
// (contrat A27 §28-32, décision explicite, même doctrine que
// DeliveryEvidence/A26) : une Mission TERMINEE/ANNULEE ou une
// DeliverableVersion FINALIZED/REJECTED n'empêchent jamais la création
// d'une DeliveryQualityGate historiquement nécessaire.
//
// Pas de transaction Serializable ici : aucune ligne DeliveryQualityGate
// ne porte d'invariant croisé avec une autre — plusieurs évaluations
// indépendantes peuvent légitimement coexister sur la même cible (voir
// schema.prisma) — contrairement à la création de DeliveryEvidence (A26)
// ou DeliverableVersion (A25), qui doivent détecter/superséder une ligne
// courante unique.
export async function creerQualityGate(params: CreationQualityGateParams) {
  const version = await prisma.deliverableVersion.findUnique({
    where: { id: params.deliverableVersionId },
    select: { id: true, deliverableId: true },
  });
  if (!version) throw new DeliverableVersionIntrouvableError();

  const deliverable = await prisma.deliverable.findUnique({
    where: { id: version.deliverableId },
    select: { missionId: true, acceptanceCriteria: true },
  });
  // "Introuvable" et "cible d'une autre Mission" produisent la même
  // erreur — jamais une fuite d'existence IDOR (même doctrine que A26).
  if (!deliverable || deliverable.missionId !== params.missionId) throw new DeliverableVersionIntrouvableError();

  const criteresEvalues = criteresNormalises(params.criteresEvalues);
  const resultat = validerResultat(params.resultat);

  return prisma.deliveryQualityGate.create({
    data: {
      deliverableVersionId: version.id,
      criteresEvalues,
      // Copie figée au moment de la création, jamais relue live ensuite
      // (contrat A27 §9/§10) — null si absent, jamais une valeur
      // inventée.
      acceptanceCriteriaSnapshot: deliverable.acceptanceCriteria ?? null,
      resultat,
      evaluatedByEmail: params.evaluatedByEmail,
      evaluatedByRole: params.evaluatedByRole,
      createdByEmail: params.createdByEmail,
    },
  });
}

export async function listerQualityGatesDeliverableVersion(deliverableVersionId: string) {
  return prisma.deliveryQualityGate.findMany({ where: { deliverableVersionId }, orderBy: { createdAt: "asc" } });
}

export async function listerQualityGatesMission(missionId: string) {
  return prisma.deliveryQualityGate.findMany({
    where: { deliverableVersion: { deliverable: { missionId } } },
    orderBy: { createdAt: "asc" },
  });
}

// Résout une QualityGate ET vérifie qu'elle appartient bien à la Mission
// du contexte URL via SA PROPRE cible — jamais supposée (même doctrine
// que A26 §43). "Introuvable" et "autre Mission" -> même erreur.
export async function lireQualityGate(missionId: string, qualityGateId: string) {
  const gate = await prisma.deliveryQualityGate.findUnique({
    where: { id: qualityGateId },
    include: { deliverableVersion: { select: { deliverable: { select: { missionId: true } } } } },
  });
  if (!gate || gate.deliverableVersion.deliverable.missionId !== missionId) throw new QualityGateIntrouvableError();
  return gate;
}

export type MiseAJourQualityGateParams = {
  missionId: string;
  qualityGateId: string;
  criteresEvalues?: unknown;
  resultat?: unknown;
};

// Édition du CONTENU (criteresEvalues/resultat) — autorisée UNIQUEMENT
// tant que la ligne est DRAFT (contrat A27 §17/§18, même doctrine que
// DeliverableVersion : "une fois FINALIZED, le contenu devient
// immuable"). Écriture conditionnelle en une seule instruction (WHERE
// id+statut=DRAFT) — jamais une transaction Serializable, aucun
// invariant croisé entre lignes.
export async function mettreAJourQualityGate(params: MiseAJourQualityGateParams) {
  const gate = await lireQualityGate(params.missionId, params.qualityGateId);
  if (gate.statut !== "DRAFT") throw new QualityGateFinaliseeError();

  const data: Prisma.DeliveryQualityGateUpdateInput = {};
  if (params.criteresEvalues !== undefined) data.criteresEvalues = criteresNormalises(params.criteresEvalues);
  if (params.resultat !== undefined) data.resultat = validerResultat(params.resultat);

  const ecriture = await prisma.deliveryQualityGate.updateMany({
    where: { id: params.qualityGateId, statut: "DRAFT" },
    data,
  });
  if (ecriture.count === 0) {
    // Stale : une finalisation concurrente a déjà eu lieu entre la
    // lecture et cette écriture — jamais un écrasement.
    throw new QualityGateFinaliseeError();
  }

  return prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: params.qualityGateId } });
}

// Finalisation — RBAC (ADMIN uniquement, contrat A27 §17-21) entièrement
// contrôlée par l'appelant (route), jamais ici. Écriture conditionnelle
// (WHERE id+statut=DRAFT) : deux finalisations simultanées -> une seule
// gagne, l'autre reçoit TransitionInvalideError — jamais un état
// impossible (contrat A27 §55-57) — même discipline que
// lib/deliverable/version.ts::executerTransitionVersion.
export async function finaliserQualityGate(missionId: string, qualityGateId: string) {
  const gate = await lireQualityGate(missionId, qualityGateId);
  const statutDepart = gate.statut;

  if (statutDepart !== "DRAFT") {
    throw new TransitionInvalideError(statutDepart, "FINALIZED");
  }

  const ecriture = await prisma.deliveryQualityGate.updateMany({
    where: { id: qualityGateId, statut: "DRAFT" },
    data: { statut: "FINALIZED" },
  });
  if (ecriture.count === 0) {
    // Stale : une autre finalisation a déjà eu lieu entre la lecture et
    // cette écriture — jamais un écrasement, jamais un double FINALIZED.
    throw new TransitionInvalideError(statutDepart, "FINALIZED");
  }

  return prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: qualityGateId } });
}

export type CreationLienParams = {
  missionId: string;
  qualityGateId: string;
  deliveryEvidenceId: string;
  createdByEmail: string;
};

async function resoudreMissionEvidence(evidence: { workItemId: string | null; deliverableVersionId: string | null }): Promise<string | null> {
  if (evidence.workItemId) {
    const workItem = await prisma.workItem.findUnique({ where: { id: evidence.workItemId }, select: { missionId: true } });
    return workItem?.missionId ?? null;
  }
  if (evidence.deliverableVersionId) {
    const version = await prisma.deliverableVersion.findUnique({ where: { id: evidence.deliverableVersionId }, select: { deliverableId: true } });
    if (!version) return null;
    const deliverable = await prisma.deliverable.findUnique({ where: { id: version.deliverableId }, select: { missionId: true } });
    return deliverable?.missionId ?? null;
  }
  return null;
}

// Lien de PROVENANCE — jamais une copie de contenu (contrat A27
// §14/§15/§16). Cohérence de Mission vérifiée via la cible RÉELLE de
// l'Evidence (WorkItem -> missionId direct ; DeliverableVersion ->
// Deliverable -> missionId) — jamais supposée égale à params.missionId
// sans vérifier (même doctrine que A26 §43). AUCUNE vérification de
// supersession de l'Evidence : une Evidence supersédée reste légalement
// référençable (contrat A27 §16) — volontaire, jamais un filtrage.
export async function creerLienEvidence(params: CreationLienParams) {
  const gate = await lireQualityGate(params.missionId, params.qualityGateId);
  if (gate.statut !== "DRAFT") throw new QualityGateFinaliseeError();

  const evidence = await prisma.deliveryEvidence.findUnique({
    where: { id: params.deliveryEvidenceId },
    select: { id: true, workItemId: true, deliverableVersionId: true },
  });
  if (!evidence) throw new DeliveryEvidenceIntrouvableError();

  const missionEvidence = await resoudreMissionEvidence(evidence);
  // "Introuvable" et "appartient à une autre Mission" -> même erreur,
  // jamais une fuite d'existence IDOR.
  if (!missionEvidence || missionEvidence !== params.missionId) throw new DeliveryEvidenceIntrouvableError();

  try {
    return await prisma.qualityEvidenceLink.create({
      data: {
        qualityGateId: params.qualityGateId,
        deliveryEvidenceId: params.deliveryEvidenceId,
        createdByEmail: params.createdByEmail,
      },
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new LienDejaExistantError();
    }
    throw erreur;
  }
}

export async function listerLiensEvidence(missionId: string, qualityGateId: string) {
  await lireQualityGate(missionId, qualityGateId);
  return prisma.qualityEvidenceLink.findMany({ where: { qualityGateId }, orderBy: { createdAt: "asc" } });
}

export type SuppressionLienParams = {
  missionId: string;
  qualityGateId: string;
  linkId: string;
};

// Hard delete — même discipline que DeliverableWorkItemLink (A25 §44) :
// ce lien ne porte lui-même aucun fait métier à historiser, seul un
// pointeur de traçabilité. Uniquement tant que la Quality parente est
// DRAFT (contrat A27 §17-20).
export async function supprimerLienEvidence(params: SuppressionLienParams) {
  const gate = await lireQualityGate(params.missionId, params.qualityGateId);
  if (gate.statut !== "DRAFT") throw new QualityGateFinaliseeError();

  const lien = await prisma.qualityEvidenceLink.findUnique({ where: { id: params.linkId } });
  if (!lien || lien.qualityGateId !== params.qualityGateId) throw new LienIntrouvableError();

  await prisma.qualityEvidenceLink.delete({ where: { id: params.linkId } });
}
