import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.5, §7, CTO Validation §13/§16 (verrouillées). Append-only via
// supersedesId (pattern exact de lib/financial-result/financial-result.ts).
// Invariant Serializable+retry : au plus une CandidateFinalDecision
// "active" (non-supersédée) par demandeTalentId, §14 — contrairement à
// FinancialResult (plusieurs lignes indépendantes coexistent), ici la
// relecture en transaction protège une unicité réelle.
//
// Règle verrouillée (CTO Validation §13, MODIFIED) : la décision finale
// appartient EXCLUSIVEMENT au Client. `decideParEmail` doit être un email
// CLIENT, SAUF si `communiqueParClientHorsSysteme: true` ET
// `canalHorsSysteme` renseigné (Admin enregistrant une décision communiquée
// hors système — jamais une décision Admin autonome). Validé ici au niveau
// service, jamais en DB.
//
// RBAC : `decideParRole` est fourni par l'appelant (route API), jamais
// revérifié contre une table ici — même discipline que
// `calculatedByRole` dans lib/financial-result/financial-result.ts. Ce
// module n'importe et n'appelle jamais rien du domaine Mission/Proposal :
// cette décision ne crée jamais de Mission ni de Proposal (confirmé
// verrouillé, §1.5).

export class DemandeTalentIntrouvableError extends Error {
  constructor() {
    super("DEMANDE_TALENT_INTROUVABLE");
  }
}

export class CommuniqueHorsSystemeRequisError extends Error {
  constructor() {
    super("COMMUNIQUE_HORS_SYSTEME_REQUIS");
  }
}

export class EntreesInvalidesError extends Error {
  constructor() {
    super("ENTREES_INVALIDES");
  }
}

export class JustificationRequiseError extends Error {
  constructor() {
    super("JUSTIFICATION_REQUISE");
  }
}

export class CandidateSelectionReferenceIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_SELECTION_REFERENCE_INTROUVABLE");
  }
}

export class DecisionActiveExistanteError extends Error {
  constructor() {
    super("DECISION_ACTIVE_EXISTANTE");
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

export class CandidateFinalDecisionIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_FINAL_DECISION_INTROUVABLE");
  }
}

type StatutEntree = "RETENU" | "NON_RETENU";
type EntreeValidee = { candidateSelectionId: string; statut: StatutEntree; justification?: string };

function validerEntrees(valeur: unknown): EntreeValidee[] {
  if (!Array.isArray(valeur) || valeur.length === 0) throw new EntreesInvalidesError();

  const vues = new Set<string>();
  return valeur.map((entree): EntreeValidee => {
    if (typeof entree !== "object" || entree === null) throw new EntreesInvalidesError();
    const { candidateSelectionId, statut, justification } = entree as Record<string, unknown>;

    if (typeof candidateSelectionId !== "string" || candidateSelectionId.length === 0) throw new EntreesInvalidesError();
    if (statut !== "RETENU" && statut !== "NON_RETENU") throw new EntreesInvalidesError();
    if (vues.has(candidateSelectionId)) throw new EntreesInvalidesError();
    vues.add(candidateSelectionId);

    if (statut === "NON_RETENU") {
      if (typeof justification !== "string" || justification.trim().length === 0) throw new JustificationRequiseError();
      return { candidateSelectionId, statut, justification: justification.trim().slice(0, 1000) };
    }

    const justificationFacultative = typeof justification === "string" && justification.trim().length > 0 ? justification.trim().slice(0, 1000) : undefined;
    return { candidateSelectionId, statut, justification: justificationFacultative };
  });
}

export type CreationCandidateFinalDecisionParams = {
  demandeTalentId: string;
  decideParEmail: string;
  decideParRole: "CLIENT" | "ADMIN";
  communiqueParClientHorsSysteme?: boolean;
  canalHorsSysteme?: string;
  entrees: unknown;
  supersedesId?: string | null;
};

async function creerCandidateFinalDecision(tx: Prisma.TransactionClient, params: CreationCandidateFinalDecisionParams) {
  const demandeTalent = await tx.demandeTalent.findUnique({ where: { id: params.demandeTalentId }, select: { id: true } });
  if (!demandeTalent) throw new DemandeTalentIntrouvableError();

  // CTO Validation §13, verrouillée — jamais une décision Admin autonome.
  let communiqueParClientHorsSysteme = false;
  let canalHorsSysteme: string | null = null;
  if (params.decideParRole !== "CLIENT") {
    if (
      params.communiqueParClientHorsSysteme !== true ||
      typeof params.canalHorsSysteme !== "string" ||
      params.canalHorsSysteme.trim().length === 0
    ) {
      throw new CommuniqueHorsSystemeRequisError();
    }
    communiqueParClientHorsSysteme = true;
    canalHorsSysteme = params.canalHorsSysteme.trim();
  }

  const entrees = validerEntrees(params.entrees);

  const candidateSelections = await tx.candidateSelection.findMany({
    where: { id: { in: entrees.map((e) => e.candidateSelectionId) }, demandeTalentId: params.demandeTalentId },
    select: { id: true },
  });
  if (candidateSelections.length !== entrees.length) throw new CandidateSelectionReferenceIntrouvableError();

  // Relecture DANS la transaction (Serializable) — au plus une décision
  // active (non-supersédée) par demandeTalentId, §14.
  const decisionActive = await tx.candidateFinalDecision.findFirst({
    where: { demandeTalentId: params.demandeTalentId, supersededBy: null },
    select: { id: true },
  });

  let supersedesId: string | null = null;
  if (decisionActive) {
    if (params.supersedesId !== decisionActive.id) throw new DecisionActiveExistanteError();
    supersedesId = decisionActive.id;
  } else if (params.supersedesId) {
    throw new SupersedesIntrouvableError();
  }

  return tx.candidateFinalDecision.create({
    data: {
      demandeTalentId: params.demandeTalentId,
      decideParEmail: params.decideParEmail,
      communiqueParClientHorsSysteme,
      canalHorsSysteme,
      supersedesId,
      entrees: {
        create: entrees.map((e) => ({
          candidateSelectionId: e.candidateSelectionId,
          statut: e.statut,
          justification: e.justification,
        })),
      },
    },
    include: { entrees: true },
  });
}

const MAX_TENTATIVES = 3;

export async function creerCandidateFinalDecisionAvecRetry(params: CreationCandidateFinalDecisionParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerCandidateFinalDecision(tx, params), {
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
  throw new Error("ECHEC_CANDIDATE_FINAL_DECISION_CONCURRENCE");
}

// Lecture seule — décision active (non-supersédée) courante, ou null si
// aucune décision n'a encore été enregistrée pour cette DemandeTalent.
export async function lireCandidateFinalDecisionActive(demandeTalentId: string) {
  return prisma.candidateFinalDecision.findFirst({
    where: { demandeTalentId, supersededBy: null },
    include: { entrees: true },
  });
}

export async function listerCandidateFinalDecisionsDemandeTalent(demandeTalentId: string) {
  return prisma.candidateFinalDecision.findMany({
    where: { demandeTalentId },
    include: { entrees: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function lireCandidateFinalDecision(demandeTalentId: string, decisionId: string) {
  const decision = await prisma.candidateFinalDecision.findUnique({ where: { id: decisionId }, include: { entrees: true } });
  if (!decision || decision.demandeTalentId !== demandeTalentId) throw new CandidateFinalDecisionIntrouvableError();
  return decision;
}
