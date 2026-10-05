import { Prisma } from "@prisma/client";
import type { LearningType, LearningProvenance, LearningConfidence, LearningScope, LearningStatut, LearningApplicabilite } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A30 : Learning Foundation (05/10/2026).
//
// Service centralisant TOUS les invariants Learning (cohérence Mission,
// cohérence source précise, validation contenu/provenance/confidence/
// scope, lifecycle de validation, applicabilité, succession, IDOR) —
// jamais dispersés entre les routes. Ce module ne vérifie JAMAIS
// session.role lui-même pour la lecture (RBAC entièrement contrôlé par
// l'appelant — voir les routes), même discipline que
// lib/delivery-quality/quality.ts (A27) et lib/financial-result/
// financial-result.ts (A29). Exception documentée : la restriction de
// `scope` pour un créateur INGENIEUR (contrat A30 §18) est un invariant
// MÉTIER du domaine Learning lui-même (jamais une vérification de session
// complète), donc légitimement ici plutôt que dans la route — le rôle du
// créateur est reçu en paramètre, jamais relu depuis une session.
//
// AUCUNE modification d'un moteur précédent (contrat A30 §3.1/§3.3) : ce
// module ne modifie JAMAIS Mission/WorkItem/Deliverable/DeliverableVersion/
// DeliveryEvidence/DeliveryQualityGate/OutcomeAssessment/FinancialResult/
// ClientNeed/ClientNeedFait/SolutionOption/CapabilityRequirement — il ne
// fait jamais que les LIRE pour vérifier l'appartenance Mission d'une
// source précise.

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class ContenuManquantError extends Error {
  constructor(public readonly champ: "title" | "statement") {
    super("CONTENU_MANQUANT");
  }
}

export class TypeInvalideError extends Error {
  constructor() {
    super("TYPE_INVALIDE");
  }
}

export class ProvenanceInvalideError extends Error {
  constructor() {
    super("PROVENANCE_INVALIDE");
  }
}

export class ConfidenceInvalideError extends Error {
  constructor() {
    super("CONFIDENCE_INVALIDE");
  }
}

export class ScopeInvalideError extends Error {
  constructor() {
    super("SCOPE_INVALIDE");
  }
}

// Un Ingénieur ne peut jamais déclarer, seul, une portée plus large que
// MISSION (contrat A30 §9/§18 : "il ne doit jamais pouvoir transformer
// seul une inférence en connaissance ATLAS globale") — distinct de
// ScopeInvalideError (qui signale une valeur d'enum invalide), ici la
// valeur EST une LearningScope valide mais interdite à ce rôle précis.
export class ScopeNonAutoriseError extends Error {
  constructor() {
    super("SCOPE_NON_AUTORISE");
  }
}

// "Introuvable" et "appartient à une autre Mission" produisent EXACTEMENT
// la même erreur pour une source précise — jamais une fuite d'existence
// IDOR (même doctrine que A26 §9/§37/§46, A27 §51-54, A29 §42/§43).
export class SourceIntrouvableError extends Error {
  constructor() {
    super("SOURCE_INTROUVABLE");
  }
}

// Plus d'une source précise fournie simultanément (contrat A30 §7/§8,
// "source précise" au singulier) — jamais une combinaison arbitraire
// acceptée.
export class SourceMultipleError extends Error {
  constructor() {
    super("SOURCE_MULTIPLE");
  }
}

export class LearningIntrouvableError extends Error {
  constructor() {
    super("LEARNING_INTROUVABLE");
  }
}

export class SupersedesIntrouvableError extends Error {
  constructor() {
    super("SUPERSEDES_INTROUVABLE");
  }
}

export class DejaSupersedeError extends Error {
  constructor() {
    super("DEJA_SUPERSEDE");
  }
}

export class DejaValideError extends Error {
  constructor() {
    super("DEJA_VALIDE");
  }
}

export class DejaObsoleteError extends Error {
  constructor() {
    super("DEJA_OBSOLETE");
  }
}

const TYPES_VALIDES: LearningType[] = ["LESSON", "PATTERN", "BEST_PRACTICE", "ANTI_PATTERN", "RECOMMENDATION", "INSIGHT"];
const PROVENANCES_VALIDES: LearningProvenance[] = ["OBSERVED", "DECLARED", "VERIFIED", "INFERRED"];
const CONFIDENCES_VALIDES: LearningConfidence[] = ["LOW", "MEDIUM", "HIGH"];
const SCOPES_VALIDES: LearningScope[] = ["MISSION", "CLIENT", "DOMAIN", "CAPABILITY", "ATLAS"];

function validerContenu(valeur: unknown, champ: "title" | "statement"): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) throw new ContenuManquantError(champ);
  return valeur.trim().slice(0, champ === "title" ? 200 : 4000);
}

function validerType(valeur: unknown): LearningType {
  if (typeof valeur !== "string" || !TYPES_VALIDES.includes(valeur as LearningType)) throw new TypeInvalideError();
  return valeur as LearningType;
}

function validerProvenance(valeur: unknown): LearningProvenance {
  if (typeof valeur !== "string" || !PROVENANCES_VALIDES.includes(valeur as LearningProvenance)) throw new ProvenanceInvalideError();
  return valeur as LearningProvenance;
}

function validerConfidence(valeur: unknown): LearningConfidence {
  if (typeof valeur !== "string" || !CONFIDENCES_VALIDES.includes(valeur as LearningConfidence)) throw new ConfidenceInvalideError();
  return valeur as LearningConfidence;
}

// Scope par défaut MISSION si absent — jamais élargi automatiquement
// (contrat A30 §9). Un Ingénieur fournissant explicitement autre chose
// que MISSION est refusé (contrat A30 §18) plutôt que silencieusement
// ramené à MISSION — jamais une mutation silencieuse de l'intention de
// l'appelant (contrat A30 §13).
function validerScope(valeur: unknown, creatorRole: string): LearningScope {
  const scope = valeur === undefined || valeur === null ? "MISSION" : valeur;
  if (typeof scope !== "string" || !SCOPES_VALIDES.includes(scope as LearningScope)) throw new ScopeInvalideError();
  if (creatorRole === "INGENIEUR" && scope !== "MISSION") throw new ScopeNonAutoriseError();
  return scope as LearningScope;
}

type SourcePreciseChamp =
  | "sourceWorkItemId"
  | "sourceDeliverableId"
  | "sourceDeliverableVersionId"
  | "sourceDeliveryEvidenceId"
  | "sourceDeliveryQualityGateId"
  | "sourceOutcomeAssessmentId"
  | "sourceFinancialResultId";

const CHAMPS_SOURCE_PRECISE: SourcePreciseChamp[] = [
  "sourceWorkItemId",
  "sourceDeliverableId",
  "sourceDeliverableVersionId",
  "sourceDeliveryEvidenceId",
  "sourceDeliveryQualityGateId",
  "sourceOutcomeAssessmentId",
  "sourceFinancialResultId",
];

// Résout le missionId réel d'une source précise, quel que soit son
// niveau d'indirection vers Mission (contrat A30 §7) :
// - WorkItem/Deliverable/OutcomeAssessment/FinancialResult portent
//   missionId directement ;
// - DeliverableVersion -> Deliverable.missionId (1 jointure) ;
// - DeliveryQualityGate -> DeliverableVersion -> Deliverable.missionId
//   (2 jointures) ;
// - DeliveryEvidence -> soit WorkItem.missionId, soit
//   DeliverableVersion -> Deliverable.missionId selon sa cible XOR (A26).
// Retourne null si l'identifiant n'existe pas — jamais distingué de
// "appartient à une autre Mission" par l'appelant (contrat A30 §7,
// même erreur SourceIntrouvableError dans les deux cas).
async function resoudreMissionIdSourcePrecise(champ: SourcePreciseChamp, id: string): Promise<string | null> {
  switch (champ) {
    case "sourceWorkItemId": {
      const r = await prisma.workItem.findUnique({ where: { id }, select: { missionId: true } });
      return r?.missionId ?? null;
    }
    case "sourceDeliverableId": {
      const r = await prisma.deliverable.findUnique({ where: { id }, select: { missionId: true } });
      return r?.missionId ?? null;
    }
    case "sourceDeliverableVersionId": {
      const r = await prisma.deliverableVersion.findUnique({ where: { id }, select: { deliverable: { select: { missionId: true } } } });
      return r?.deliverable.missionId ?? null;
    }
    case "sourceDeliveryEvidenceId": {
      const r = await prisma.deliveryEvidence.findUnique({
        where: { id },
        select: {
          workItem: { select: { missionId: true } },
          deliverableVersion: { select: { deliverable: { select: { missionId: true } } } },
        },
      });
      if (!r) return null;
      return r.workItem?.missionId ?? r.deliverableVersion?.deliverable.missionId ?? null;
    }
    case "sourceDeliveryQualityGateId": {
      const r = await prisma.deliveryQualityGate.findUnique({
        where: { id },
        select: { deliverableVersion: { select: { deliverable: { select: { missionId: true } } } } },
      });
      return r?.deliverableVersion.deliverable.missionId ?? null;
    }
    case "sourceOutcomeAssessmentId": {
      const r = await prisma.outcomeAssessment.findUnique({ where: { id }, select: { missionId: true } });
      return r?.missionId ?? null;
    }
    case "sourceFinancialResultId": {
      const r = await prisma.financialResult.findUnique({ where: { id }, select: { missionId: true } });
      return r?.missionId ?? null;
    }
  }
}

// Au plus UNE source précise à la fois (contrat A30 §7/§8) — jamais une
// table polymorphe générique, voir commentaire du modèle Learning.
async function resoudreSourcePrecise(missionId: string, params: Partial<Record<SourcePreciseChamp, unknown>>): Promise<Partial<Record<SourcePreciseChamp, string>>> {
  const fournis = CHAMPS_SOURCE_PRECISE.filter((champ) => typeof params[champ] === "string" && (params[champ] as string).length > 0);
  if (fournis.length > 1) throw new SourceMultipleError();
  if (fournis.length === 0) return {};

  const champ = fournis[0];
  const id = params[champ] as string;
  const missionIdSource = await resoudreMissionIdSourcePrecise(champ, id);
  // "Introuvable" et "appartient à une autre Mission" -> même erreur,
  // jamais une fuite d'existence IDOR (contrat A30 §7, règle absolue).
  if (!missionIdSource || missionIdSource !== missionId) throw new SourceIntrouvableError();

  return { [champ]: id };
}

export type CreationLearningParams = {
  missionId: string;
  type?: unknown;
  title?: unknown;
  statement?: unknown;
  provenance?: unknown;
  confidence?: unknown;
  scope?: unknown;
  sourceWorkItemId?: unknown;
  sourceDeliverableId?: unknown;
  sourceDeliverableVersionId?: unknown;
  sourceDeliveryEvidenceId?: unknown;
  sourceDeliveryQualityGateId?: unknown;
  sourceOutcomeAssessmentId?: unknown;
  sourceFinancialResultId?: unknown;
  supersedesId?: string | null;
  createdByEmail: string;
  createdByRole: string;
};

// AUCUNE vérification Mission.statut ici (même doctrine que
// DeliveryEvidence/DeliveryQualityGate/FinancialResult, contrat A30
// implicite par alignement A26/A27/A29 — un Learning documente une
// expérience passée, jamais bloqué par le statut courant de la Mission).
async function creerLearning(tx: Prisma.TransactionClient, params: CreationLearningParams) {
  const mission = await tx.mission.findUnique({ where: { id: params.missionId }, select: { id: true } });
  if (!mission) throw new MissionIntrouvableError();

  const title = validerContenu(params.title, "title");
  const statement = validerContenu(params.statement, "statement");
  const type = validerType(params.type);
  const provenance = validerProvenance(params.provenance);
  const confidence = validerConfidence(params.confidence);
  const scope = validerScope(params.scope, params.createdByRole);

  const source = await resoudreSourcePrecise(params.missionId, {
    sourceWorkItemId: params.sourceWorkItemId,
    sourceDeliverableId: params.sourceDeliverableId,
    sourceDeliverableVersionId: params.sourceDeliverableVersionId,
    sourceDeliveryEvidenceId: params.sourceDeliveryEvidenceId,
    sourceDeliveryQualityGateId: params.sourceDeliveryQualityGateId,
    sourceOutcomeAssessmentId: params.sourceOutcomeAssessmentId,
    sourceFinancialResultId: params.sourceFinancialResultId,
  });

  let supersedesId: string | null = null;
  if (params.supersedesId) {
    const ancien = await tx.learning.findUnique({ where: { id: params.supersedesId }, select: { id: true, missionId: true } });
    // Cross-Mission (donc cross-client, Mission.clientId étant fixe)
    // structurellement refusé — "introuvable" et "autre Mission" ->
    // même erreur (contrat A30 §14, même doctrine IDOR que A26/A27/A29).
    if (!ancien || ancien.missionId !== params.missionId) throw new SupersedesIntrouvableError();

    const dejaSuperseded = await tx.learning.findFirst({ where: { supersedesId: params.supersedesId }, select: { id: true } });
    if (dejaSuperseded) throw new DejaSupersedeError();

    supersedesId = params.supersedesId;
  }

  return tx.learning.create({
    data: {
      missionId: params.missionId,
      ...source,
      type,
      title,
      statement,
      provenance,
      confidence,
      scope,
      supersedesId,
      createdByEmail: params.createdByEmail,
      createdByRole: params.createdByRole,
    },
  });
}

const MAX_TENTATIVES = 3;

// Pas de transaction Serializable nécessaire pour un invariant croisé de
// ligne "courante" (plusieurs Learning indépendants coexistent librement
// pour la même Mission/source, contrat A30 §14 — aucune notion de "the
// current Learning" à protéger, à l'inverse de OutcomeAssessment). La
// transaction reste utile pour la cohérence lecture+écriture de
// supersedesId ; le filet de sécurité ultime sous concurrence réelle
// reste l'index unique (traduit en DejaSupersedeError sur P2002), même
// patron que lib/financial-result/financial-result.ts (A29).
export async function creerLearningAvecRetry(params: CreationLearningParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerLearning(tx, params));
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") throw new DejaSupersedeError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_LEARNING_CONCURRENCE");
}

export async function listerLearningsMission(missionId: string) {
  return prisma.learning.findMany({ where: { missionId }, orderBy: { createdAt: "asc" } });
}

// "Introuvable" et "autre Mission" -> même erreur (contrat A30 §19 IDOR).
export async function lireLearning(missionId: string, learningId: string) {
  const learning = await prisma.learning.findUnique({ where: { id: learningId } });
  if (!learning || learning.missionId !== missionId) throw new LearningIntrouvableError();
  return learning;
}

// "valider" (contrat A30 §18/§22) : PROPOSE -> VALIDE, réservé ADMIN
// (RBAC contrôlé par la route). Ne modifie JAMAIS `provenance` — une
// inférence IA validée reste INFERRED pour toujours (contrat A30 §3.2,
// "aucune promotion automatique"), seul `statut` change. Écriture
// conditionnelle (WHERE id+statut=PROPOSE) : deux validations
// simultanées -> une seule gagne, l'autre reçoit DejaValideError.
export async function validerLearning(missionId: string, learningId: string, validatedByEmail: string) {
  const existant = await lireLearning(missionId, learningId);
  if (existant.statut !== "PROPOSE") throw new DejaValideError();

  const ecriture = await prisma.learning.updateMany({
    where: { id: learningId, statut: "PROPOSE" },
    data: { statut: "VALIDE", validatedAt: new Date(), validatedByEmail },
  });
  if (ecriture.count === 0) throw new DejaValideError();

  return prisma.learning.findUniqueOrThrow({ where: { id: learningId } });
}

// "marquer_obsolete" (contrat A30 §10) : ACTIVE -> OBSOLETE, réservé
// ADMIN. Jamais l'inverse (réactivation = nouveau Learning, même
// discipline append-only que ClientNeedFait.statutActivite). Indépendant
// de `statut`/supersession — ne mute JAMAIS une autre ligne (contrat A30
// §13, "aucune mutation silencieuse").
export async function marquerObsoleteLearning(missionId: string, learningId: string, obsoleteByEmail: string) {
  const existant = await lireLearning(missionId, learningId);
  if (existant.applicabilite !== "ACTIVE") throw new DejaObsoleteError();

  const ecriture = await prisma.learning.updateMany({
    where: { id: learningId, applicabilite: "ACTIVE" },
    data: { applicabilite: "OBSOLETE", obsoleteAt: new Date(), obsoleteByEmail },
  });
  if (ecriture.count === 0) throw new DejaObsoleteError();

  return prisma.learning.findUniqueOrThrow({ where: { id: learningId } });
}

export type { LearningType, LearningProvenance, LearningConfidence, LearningScope, LearningStatut, LearningApplicabilite };
