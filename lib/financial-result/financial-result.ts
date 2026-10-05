import { Prisma } from "@prisma/client";
import type { FinancialResultGlobal, FinancialResultProvenance, FinancialResultStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A29 : Financial Result Foundation (05/10/2026).
//
// Service centralisant TOUS les invariants FinancialResult (cohérence
// Mission, validation Revenue/Cost + provenance, calcul Profit/Margin,
// lifecycle, succession, IDOR) — jamais dispersés entre les routes. Ce
// module ne vérifie JAMAIS session.role lui-même (RBAC entièrement
// contrôlé par l'appelant — voir les routes), même discipline que
// lib/delivery-quality/quality.ts (A27).
//
// AUCUN calcul automatique de Revenue/Cost depuis Mission.tjmVente/
// nbJours/margeCible, ni depuis MissionAssignment.allocationPct, ni depuis
// Facture/Paiement (contrat A29 §16/§37/§38/§47, décision documentée dans
// prisma/schema.prisma) — Revenue et Cost sont toujours des montants
// DÉCLARÉS explicitement par l'appelant (ADMIN), jamais déduits.
//
// Domaine FRÈRE de DeliveryEvidence/DeliveryQualityGate/OutcomeAssessment
// sous Mission — définit ses propres erreurs plutôt que d'importer celles
// des domaines voisins (même discipline que chaque lot précédent).

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class MontantInvalideError extends Error {
  constructor(public readonly champ: "revenue" | "cost") {
    super("MONTANT_INVALIDE");
  }
}

export class ProvenanceManquanteError extends Error {
  constructor(public readonly champ: "revenue" | "cost") {
    super("PROVENANCE_MANQUANTE");
  }
}

export class JustificationManquanteError extends Error {
  constructor(public readonly champ: "revenue" | "cost") {
    super("JUSTIFICATION_MANQUANTE");
  }
}

export class DeviseInvalideError extends Error {
  constructor() {
    super("DEVISE_INVALIDE");
  }
}

// "Introuvable" et "appartient à une autre Mission" produisent EXACTEMENT
// la même erreur — jamais une fuite d'existence IDOR (même doctrine que
// A26 §9/§37/§46, A27 §51-54).
export class FinancialResultIntrouvableError extends Error {
  constructor() {
    super("FINANCIAL_RESULT_INTROUVABLE");
  }
}

export class FinancialResultFinaliseeError extends Error {
  constructor() {
    super("FINANCIAL_RESULT_FINALISEE");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: FinancialResultStatut, public readonly vers: FinancialResultStatut) {
    super("TRANSITION_INVALIDE");
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

const PROVENANCES_VALIDES: FinancialResultProvenance[] = ["DECLARE", "VERIFIE"];

// Accepte aussi bien une saisie brute (number/string, depuis le body JSON
// d'une route) qu'une instance Prisma.Decimal déjà résolue (depuis une
// ligne existante relue pour une mise à jour partielle, voir
// mettreAJourFinancialResult ci-dessous) — jamais une seconde validation
// divergente entre création et mise à jour.
function validerMontant(valeur: unknown, champ: "revenue" | "cost"): Prisma.Decimal | null {
  if (valeur === undefined || valeur === null) return null;
  if (typeof valeur !== "number" && typeof valeur !== "string" && !Prisma.Decimal.isDecimal(valeur)) {
    throw new MontantInvalideError(champ);
  }
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(valeur as Prisma.Decimal.Value);
  } catch {
    throw new MontantInvalideError(champ);
  }
  if (!decimal.isFinite() || decimal.isNegative()) throw new MontantInvalideError(champ);
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function validerProvenance(valeur: unknown, champ: "revenue" | "cost"): FinancialResultProvenance {
  if (typeof valeur !== "string" || !PROVENANCES_VALIDES.includes(valeur as FinancialResultProvenance)) {
    throw new ProvenanceManquanteError(champ);
  }
  return valeur as FinancialResultProvenance;
}

function validerJustification(valeur: unknown, champ: "revenue" | "cost"): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) throw new JustificationManquanteError(champ);
  return valeur.trim().slice(0, 1000);
}

// Résout un côté (revenue ou cost) : les trois champs (montant, provenance,
// justification) sont TOUS requis ensemble, ou TOUS absents (contrat A29
// §9) — jamais un montant stocké sans savoir d'où il vient.
function resoudreCote(
  champ: "revenue" | "cost",
  montantBrut: unknown,
  provenanceBrute: unknown,
  justificationBrute: unknown
): { montant: Prisma.Decimal | null; provenance: FinancialResultProvenance | null; justification: string | null } {
  const montant = validerMontant(montantBrut, champ);
  if (montant === null) {
    return { montant: null, provenance: null, justification: null };
  }
  const provenance = validerProvenance(provenanceBrute, champ);
  const justification = validerJustification(justificationBrute, champ);
  return { montant, provenance, justification };
}

export type ResultatCalcule = {
  profitAmount: Prisma.Decimal | null;
  marginPct: Prisma.Decimal | null;
  resultatGlobal: FinancialResultGlobal;
};

// Fonction PURE (contrat A29 §23/§24/§25) : Profit = Revenue - Cost et
// Margin% = Profit / Revenue, UNIQUEMENT si revenue ET cost sont connus —
// jamais déduit d'un seul côté, jamais un 0 implicite. Revenue = 0 connu
// (distinct d'inconnu) ne produit JAMAIS une division par zéro : marginPct
// reste explicitement null, mais profitAmount/resultatGlobal restent
// calculables (contrat A29 §24). Arrondi déterministe (ROUND_HALF_UP),
// jamais un flottant binaire imprévisible (contrat A29 §25).
export function calculerResultat(revenue: Prisma.Decimal | null, cost: Prisma.Decimal | null): ResultatCalcule {
  if (revenue === null || cost === null) {
    return { profitAmount: null, marginPct: null, resultatGlobal: "NOT_DETERMINABLE" };
  }
  const profitAmount = revenue.minus(cost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const marginPct = revenue.isZero() ? null : profitAmount.dividedBy(revenue).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const resultatGlobal: FinancialResultGlobal = profitAmount.isZero() ? "BREAK_EVEN" : profitAmount.isPositive() ? "PROFIT" : "LOSS";
  return { profitAmount, marginPct, resultatGlobal };
}

export type CreationFinancialResultParams = {
  missionId: string;
  currency?: string | null;
  revenueAmount?: unknown;
  revenueProvenance?: unknown;
  revenueJustification?: unknown;
  costAmount?: unknown;
  costProvenance?: unknown;
  costJustification?: unknown;
  supersedesId?: string | null;
  calculatedByEmail: string;
  calculatedByRole: string;
};

// AUCUNE vérification Mission.statut ici (contrat A29 §30/§31/§32,
// décision explicite, même doctrine que DeliveryEvidence/DeliveryQualityGate) :
// un Financial Result peut être créé quel que soit le statut de la
// Mission — EN_COURS (DRAFT provisoire), TERMINEE (le cas visé en
// priorité) ou ANNULEE (un résultat négatif/positif reste pertinent,
// jamais une réouverture de Mission).
async function creerFinancialResult(tx: Prisma.TransactionClient, params: CreationFinancialResultParams) {
  const mission = await tx.mission.findUnique({ where: { id: params.missionId }, select: { id: true, deviseVente: true } });
  if (!mission) throw new MissionIntrouvableError();

  const currency = typeof params.currency === "string" && params.currency.trim().length > 0 ? params.currency.trim() : mission.deviseVente;
  if (typeof currency !== "string" || currency.trim().length === 0) throw new DeviseInvalideError();

  const revenue = resoudreCote("revenue", params.revenueAmount, params.revenueProvenance, params.revenueJustification);
  const cost = resoudreCote("cost", params.costAmount, params.costProvenance, params.costJustification);
  const { profitAmount, marginPct, resultatGlobal } = calculerResultat(revenue.montant, cost.montant);

  let supersedesId: string | null = null;
  if (params.supersedesId) {
    const ancien = await tx.financialResult.findUnique({ where: { id: params.supersedesId }, select: { id: true, missionId: true } });
    // "Introuvable" et "appartient à une autre Mission" -> même erreur,
    // jamais une fuite d'existence IDOR (contrat A29 §42/§43).
    if (!ancien || ancien.missionId !== params.missionId) throw new SupersedesIntrouvableError();

    const dejaSuperseded = await tx.financialResult.findFirst({ where: { supersedesId: params.supersedesId }, select: { id: true } });
    if (dejaSuperseded) throw new DejaSupersedeError();

    supersedesId = params.supersedesId;
  }

  return tx.financialResult.create({
    data: {
      missionId: params.missionId,
      currency,
      revenueAmount: revenue.montant,
      revenueProvenance: revenue.provenance,
      revenueJustification: revenue.justification,
      costAmount: cost.montant,
      costProvenance: cost.provenance,
      costJustification: cost.justification,
      profitAmount,
      marginPct,
      resultatGlobal,
      supersedesId,
      calculatedByEmail: params.calculatedByEmail,
      calculatedByRole: params.calculatedByRole,
      createdByEmail: params.calculatedByEmail,
    },
  });
}

const MAX_TENTATIVES = 3;

// Pas de transaction Serializable nécessaire pour un invariant croisé de
// ligne courante (contrat A29 §35, décision explicite — voir
// prisma/schema.prisma) : plusieurs FinancialResult indépendants peuvent
// coexister pour la même Mission. La transaction reste utile uniquement
// pour la cohérence de la vérification supersedesId + création en un seul
// aller-retour ; le filet de sécurité ultime sous concurrence réelle reste
// l'index unique sur supersedesId (traduit en DejaSupersedeError sur
// P2002).
export async function creerFinancialResultAvecRetry(params: CreationFinancialResultParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerFinancialResult(tx, params));
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") throw new DejaSupersedeError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_FINANCIAL_RESULT_CONCURRENCE");
}

export async function listerFinancialResultsMission(missionId: string) {
  return prisma.financialResult.findMany({ where: { missionId }, orderBy: { createdAt: "asc" } });
}

// Résout UN FinancialResult ET vérifie qu'il appartient bien à la Mission
// du contexte URL — "introuvable" et "autre Mission" -> même erreur
// (contrat A29 §42).
export async function lireFinancialResult(missionId: string, resultId: string) {
  const resultat = await prisma.financialResult.findUnique({ where: { id: resultId } });
  if (!resultat || resultat.missionId !== missionId) throw new FinancialResultIntrouvableError();
  return resultat;
}

export type MiseAJourFinancialResultParams = {
  missionId: string;
  resultId: string;
  currency?: string | null;
  revenueAmount?: unknown;
  revenueProvenance?: unknown;
  revenueJustification?: unknown;
  costAmount?: unknown;
  costProvenance?: unknown;
  costJustification?: unknown;
};

// Édition du CONTENU — autorisée UNIQUEMENT tant que DRAFT (contrat A29
// §20, même doctrine que DeliveryQualityGate/A27 : "une fois FINALIZED, le
// contenu devient immuable"). Recalcule systématiquement Profit/Margin
// depuis les nouvelles valeurs — jamais une incohérence entre
// revenue/cost affichés et profit/margin stockés.
async function mettreAJourFinancialResult(tx: Prisma.TransactionClient, params: MiseAJourFinancialResultParams) {
  const existant = await tx.financialResult.findUnique({ where: { id: params.resultId } });
  if (!existant || existant.missionId !== params.missionId) throw new FinancialResultIntrouvableError();
  if (existant.statut !== "DRAFT") throw new FinancialResultFinaliseeError();

  let currency = existant.currency;
  if (params.currency !== undefined) {
    if (typeof params.currency !== "string" || params.currency.trim().length === 0) throw new DeviseInvalideError();
    currency = params.currency.trim();
  }

  const revenue =
    params.revenueAmount !== undefined || params.revenueProvenance !== undefined || params.revenueJustification !== undefined
      ? resoudreCote(
          "revenue",
          params.revenueAmount !== undefined ? params.revenueAmount : existant.revenueAmount,
          params.revenueProvenance !== undefined ? params.revenueProvenance : existant.revenueProvenance,
          params.revenueJustification !== undefined ? params.revenueJustification : existant.revenueJustification
        )
      : { montant: existant.revenueAmount, provenance: existant.revenueProvenance, justification: existant.revenueJustification };

  const cost =
    params.costAmount !== undefined || params.costProvenance !== undefined || params.costJustification !== undefined
      ? resoudreCote(
          "cost",
          params.costAmount !== undefined ? params.costAmount : existant.costAmount,
          params.costProvenance !== undefined ? params.costProvenance : existant.costProvenance,
          params.costJustification !== undefined ? params.costJustification : existant.costJustification
        )
      : { montant: existant.costAmount, provenance: existant.costProvenance, justification: existant.costJustification };

  const { profitAmount, marginPct, resultatGlobal } = calculerResultat(revenue.montant, cost.montant);

  const ecriture = await tx.financialResult.updateMany({
    where: { id: params.resultId, statut: "DRAFT" },
    data: {
      currency,
      revenueAmount: revenue.montant,
      revenueProvenance: revenue.provenance,
      revenueJustification: revenue.justification,
      costAmount: cost.montant,
      costProvenance: cost.provenance,
      costJustification: cost.justification,
      profitAmount,
      marginPct,
      resultatGlobal,
    },
  });
  if (ecriture.count === 0) {
    // Stale : une finalisation concurrente a eu lieu entre la lecture et
    // cette écriture — jamais un écrasement.
    throw new FinancialResultFinaliseeError();
  }

  return tx.financialResult.findUniqueOrThrow({ where: { id: params.resultId } });
}

export async function mettreAJourFinancialResultAvecRetry(params: MiseAJourFinancialResultParams) {
  return prisma.$transaction((tx) => mettreAJourFinancialResult(tx, params));
}

// Finalisation — RBAC (ADMIN uniquement, contrat A29 §28) entièrement
// contrôlée par l'appelant. Écriture conditionnelle (WHERE id+statut=
// DRAFT) : deux finalisations simultanées -> une seule gagne, l'autre
// reçoit TransitionInvalideError (contrat A29 §43 — même discipline que
// DeliveryQualityGate/A27).
export async function finaliserFinancialResult(missionId: string, resultId: string) {
  const existant = await lireFinancialResult(missionId, resultId);
  const statutDepart = existant.statut;

  if (statutDepart !== "DRAFT") {
    throw new TransitionInvalideError(statutDepart, "FINALIZED");
  }

  const ecriture = await prisma.financialResult.updateMany({
    where: { id: resultId, statut: "DRAFT" },
    data: { statut: "FINALIZED" },
  });
  if (ecriture.count === 0) {
    throw new TransitionInvalideError(statutDepart, "FINALIZED");
  }

  return prisma.financialResult.findUniqueOrThrow({ where: { id: resultId } });
}
