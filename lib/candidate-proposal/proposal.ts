import { Prisma, CandidateProposalStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ATLAS CANDIDATE PROPOSAL (A35.8, 11/10/2026) — voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §6
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). Même pattern
// transactionnel que lib/candidate-decision/final-decision.ts : Serializable
// + retry sur P2034, classes d'erreur dédiées jamais une correction
// silencieuse. `decideParRole`/RBAC/tenant restent entièrement du ressort
// de l'appelant (route) — ce module ne lit jamais la session.

export class CandidateFinalDecisionEntreeIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_FINAL_DECISION_ENTREE_INTROUVABLE");
  }
}

export class EntreeNonRetenueError extends Error {
  constructor() {
    super("ENTREE_NON_RETENUE");
  }
}

export class DecisionSourceNonActiveError extends Error {
  constructor() {
    super("DECISION_SOURCE_NON_ACTIVE");
  }
}

export class SupersedesInvalideError extends Error {
  constructor(detail: string) {
    super(`SUPERSEDES_INVALIDE: ${detail}`);
  }
}

export class PropositionActiveExistanteError extends Error {
  constructor() {
    super("PROPOSITION_ACTIVE_EXISTANTE");
  }
}

export class CandidateProposalIntrouvableError extends Error {
  constructor() {
    super("CANDIDATE_PROPOSAL_INTROUVABLE");
  }
}

export class TransitionInvalideError extends Error {
  constructor() {
    super("TRANSITION_INVALIDE");
  }
}

export class SnapshotIncompletError extends Error {
  constructor() {
    super("SNAPSHOT_INCOMPLET");
  }
}

export class ConflitTransitionError extends Error {
  constructor() {
    super("CONFLIT_TRANSITION");
  }
}

export class CommuniqueHorsSystemeRequisError extends Error {
  constructor() {
    super("COMMUNIQUE_HORS_SYSTEME_REQUIS");
  }
}

const MAX_TENTATIVES = 3;

async function avecRetrySerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) {
        continue;
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_CANDIDATE_PROPOSAL_CONCURRENCE");
}

// §5.2 — fonction pure, aucune écriture, aucun scheduler (précédent
// lib/url-signee.ts). EXPIREE n'est jamais stockée.
export type StatutEffectif = CandidateProposalStatut | "EXPIREE";

export function calculerStatutEffectif(
  proposal: { statut: CandidateProposalStatut; dateValidite: Date | null },
  maintenant: Date
): StatutEffectif {
  if (proposal.statut === "EMISE" && proposal.dateValidite !== null && maintenant > proposal.dateValidite) {
    return "EXPIREE";
  }
  return proposal.statut;
}

// §6.1 — Création d'un BROUILLON, avec ou sans supersedesId (successeur).
export type CreationCandidateProposalParams = {
  candidateFinalDecisionEntreeId: string;
  supersedesId?: string | null;
  createdByEmail: string;
};

async function creerCandidateProposal(tx: Prisma.TransactionClient, params: CreationCandidateProposalParams) {
  // a. Relire l'entrée cible + sa décision parente. `supersededBy` est une
  // relation inverse : elle doit être explicitement incluse pour être
  // évaluable (sinon `undefined`, jamais `null` — vérification vitale,
  // jamais une lecture implicite).
  const entree = await tx.candidateFinalDecisionEntree.findUnique({
    where: { id: params.candidateFinalDecisionEntreeId },
    include: { decision: { include: { supersededBy: { select: { id: true } } } } },
  });
  if (!entree) throw new CandidateFinalDecisionEntreeIntrouvableError();

  // b. L'entrée cible doit être RETENU.
  if (entree.statut !== "RETENU") throw new EntreeNonRetenueError();

  // c. La décision parente de l'entrée cible doit être active.
  if (entree.decision.supersededBy !== null) throw new DecisionSourceNonActiveError();

  // d. Succession (corrigé A35.4/F1, A35.6/F1) — voir IC §6.1.d.i-vii.
  if (params.supersedesId) {
    const predecesseur = await tx.candidateProposal.findUnique({
      where: { id: params.supersedesId },
      include: { candidateFinalDecisionEntree: true },
    });
    if (!predecesseur) throw new SupersedesInvalideError("prédécesseur introuvable");

    // ii. Continuité du candidat via candidateSelectionId — jamais via
    // l'égalité des candidateFinalDecisionEntreeId (chaque nouvelle
    // CandidateFinalDecision crée de nouvelles entrées, même id différent
    // pour un candidat déjà RETENU).
    if (predecesseur.candidateFinalDecisionEntree.candidateSelectionId !== entree.candidateSelectionId) {
      throw new SupersedesInvalideError("candidat différent de celui du prédécesseur");
    }

    // iv. État effectif du prédécesseur — jamais le statut brut seul.
    const etatPredecesseur = calculerStatutEffectif(predecesseur, new Date());
    const etatsTerminauxAutorises: StatutEffectif[] = ["REFUSEE", "RETIREE", "EXPIREE"];
    if (!etatsTerminauxAutorises.includes(etatPredecesseur)) {
      throw new SupersedesInvalideError("prédécesseur non terminal (ou ACCEPTEE, invariant 3)");
    }
    // REMPLACEE (prédécesseur déjà superseded) : couvert nativement par la
    // contrainte @@unique([supersedesId]) à l'étape de création (f) —
    // jamais une règle de statut supplémentaire ici (IC §6.1.d.iv).
  }

  // e. Aucune autre proposition active pour cette entrée (hors le
  // prédécesseur désigné, terminal par construction du point d).
  const active = await tx.candidateProposal.findFirst({
    where: {
      candidateFinalDecisionEntreeId: params.candidateFinalDecisionEntreeId,
      statut: { in: ["BROUILLON", "EMISE", "ACCEPTEE"] },
      ...(params.supersedesId ? { id: { not: params.supersedesId } } : {}),
    },
    select: { id: true },
  });
  if (active) throw new PropositionActiveExistanteError();

  // f. Création — demandeTalentId/clientId toujours dérivés serveur.
  return tx.candidateProposal.create({
    data: {
      candidateFinalDecisionEntreeId: params.candidateFinalDecisionEntreeId,
      demandeTalentId: entree.decision.demandeTalentId,
      clientId: (await tx.demandeTalent.findUniqueOrThrow({ where: { id: entree.decision.demandeTalentId }, select: { clientId: true } })).clientId,
      supersedesId: params.supersedesId ?? null,
      createdByEmail: params.createdByEmail,
      statut: "BROUILLON",
    },
  });
}

export async function creerCandidateProposalAvecRetry(params: CreationCandidateProposalParams) {
  return avecRetrySerializable((tx) => creerCandidateProposal(tx, params));
}

// §6.2 — Émission (BROUILLON -> EMISE), snapshot commercial fourni ici
// (aucune route d'édition séparée dans le périmètre contractuel des 8
// routes, §10 — le snapshot est donc complété au moment de l'émission,
// jamais avant).
export type EmissionSnapshot = {
  tjmPropose: number;
  devise: string;
  dureeJours: number;
  dateDebutEnvisagee?: Date | null;
  dateValidite?: Date | null;
};

export type EmissionResultat = {
  proposal: Awaited<ReturnType<typeof prisma.candidateProposal.findUniqueOrThrow>>;
  mutationReelle: boolean;
};

async function emettreCandidateProposal(
  tx: Prisma.TransactionClient,
  params: { id: string; emisParEmail: string; snapshot: EmissionSnapshot }
): Promise<EmissionResultat> {
  // a. Relire la proposition.
  const proposal = await tx.candidateProposal.findUnique({ where: { id: params.id } });
  if (!proposal) throw new CandidateProposalIntrouvableError();
  if (proposal.statut !== "BROUILLON" && proposal.statut !== "EMISE") throw new TransitionInvalideError();

  // b. Branche idempotente (course déjà gagnée).
  if (proposal.statut === "EMISE") {
    return { proposal, mutationReelle: false };
  }

  // c. Complétude du snapshot.
  if (!params.snapshot.tjmPropose || params.snapshot.tjmPropose <= 0) throw new SnapshotIncompletError();
  if (!params.snapshot.devise || params.snapshot.devise.trim().length === 0) throw new SnapshotIncompletError();
  if (!params.snapshot.dureeJours || params.snapshot.dureeJours <= 0) throw new SnapshotIncompletError();

  // d. Fraîcheur de la décision source (même requête qu'à la création).
  const entree = await tx.candidateFinalDecisionEntree.findUniqueOrThrow({
    where: { id: proposal.candidateFinalDecisionEntreeId },
    include: { decision: { include: { supersededBy: { select: { id: true } } } } },
  });
  if (entree.decision.supersededBy !== null || entree.statut !== "RETENU") {
    throw new DecisionSourceNonActiveError();
  }

  // e. Conditional update + count.
  const { count } = await tx.candidateProposal.updateMany({
    where: { id: params.id, statut: "BROUILLON" },
    data: {
      statut: "EMISE",
      emisLe: new Date(),
      emisParEmail: params.emisParEmail,
      tjmPropose: params.snapshot.tjmPropose,
      devise: params.snapshot.devise,
      dureeJours: params.snapshot.dureeJours,
      dateDebutEnvisagee: params.snapshot.dateDebutEnvisagee ?? null,
      dateValidite: params.snapshot.dateValidite ?? null,
    },
  });

  if (count === 1) {
    const mis = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
    return { proposal: mis, mutationReelle: true };
  }

  // count === 0 — course perdue, relire et appliquer la logique de (b).
  const relu = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
  if (relu.statut === "EMISE") return { proposal: relu, mutationReelle: false };
  throw new TransitionInvalideError();
}

export async function emettreCandidateProposalAvecRetry(params: { id: string; emisParEmail: string; snapshot: EmissionSnapshot }) {
  return avecRetrySerializable((tx) => emettreCandidateProposal(tx, params));
}

// §6.3 — Acceptation / Refus (EMISE -> ACCEPTEE/REFUSEE).
export type DecisionCandidateProposalParams = {
  id: string;
  decision: "ACCEPTEE" | "REFUSEE";
  decideParEmail: string;
  communiqueParClientHorsSysteme?: boolean;
  canalHorsSysteme?: string | null;
};

export type DecisionResultat = {
  proposal: Awaited<ReturnType<typeof prisma.candidateProposal.findUniqueOrThrow>>;
  mutationReelle: boolean;
};

async function decidreCandidateProposal(tx: Prisma.TransactionClient, params: DecisionCandidateProposalParams): Promise<DecisionResultat> {
  // a. Relire + état effectif.
  const proposal = await tx.candidateProposal.findUnique({ where: { id: params.id } });
  if (!proposal) throw new CandidateProposalIntrouvableError();

  const effectif = calculerStatutEffectif(proposal, new Date());
  if (effectif !== "EMISE") {
    if (effectif === params.decision && proposal.decideParEmail === params.decideParEmail) {
      return { proposal, mutationReelle: false };
    }
    throw new ConflitTransitionError();
  }

  // b. Fraîcheur de la décision source.
  const entree = await tx.candidateFinalDecisionEntree.findUniqueOrThrow({
    where: { id: proposal.candidateFinalDecisionEntreeId },
    include: { decision: { include: { supersededBy: { select: { id: true } } } } },
  });
  if (entree.decision.supersededBy !== null || entree.statut !== "RETENU") {
    throw new DecisionSourceNonActiveError();
  }

  // c. Conditional update + count.
  const { count } = await tx.candidateProposal.updateMany({
    where: { id: params.id, statut: "EMISE" },
    data: {
      statut: params.decision,
      decideLe: new Date(),
      decideParEmail: params.decideParEmail,
      communiqueParClientHorsSysteme: params.communiqueParClientHorsSysteme ?? false,
      canalHorsSysteme: params.canalHorsSysteme ?? null,
    },
  });

  if (count === 1) {
    const mis = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
    return { proposal: mis, mutationReelle: true };
  }

  // count === 0 — course concurrente, relire et appliquer la logique de (a).
  const relu = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
  const effectifRelu = calculerStatutEffectif(relu, new Date());
  if (effectifRelu === params.decision && relu.decideParEmail === params.decideParEmail) {
    return { proposal: relu, mutationReelle: false };
  }
  throw new ConflitTransitionError();
}

export async function decidreCandidateProposalAvecRetry(params: DecisionCandidateProposalParams) {
  return avecRetrySerializable((tx) => decidreCandidateProposal(tx, params));
}

// §6.4 — Retrait (BROUILLON/EMISE -> RETIREE).
export type RetraitResultat = {
  proposal: Awaited<ReturnType<typeof prisma.candidateProposal.findUniqueOrThrow>>;
  mutationReelle: boolean;
  etaitEmise: boolean;
};

async function retirerCandidateProposal(tx: Prisma.TransactionClient, params: { id: string }): Promise<RetraitResultat> {
  const avant = await tx.candidateProposal.findUnique({ where: { id: params.id } });
  if (!avant) throw new CandidateProposalIntrouvableError();

  const { count } = await tx.candidateProposal.updateMany({
    where: { id: params.id, statut: { in: ["BROUILLON", "EMISE"] } },
    data: { statut: "RETIREE", retireeLe: new Date() },
  });

  if (count === 1) {
    const mis = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
    return { proposal: mis, mutationReelle: true, etaitEmise: avant.statut === "EMISE" };
  }

  // count === 0 — relire.
  const relu = await tx.candidateProposal.findUniqueOrThrow({ where: { id: params.id } });
  if (relu.statut === "RETIREE") return { proposal: relu, mutationReelle: false, etaitEmise: false };
  throw new ConflitTransitionError();
}

export async function retirerCandidateProposalAvecRetry(params: { id: string }) {
  return avecRetrySerializable((tx) => retirerCandidateProposal(tx, params));
}

// Lectures — hors transaction métier, pas de garde RBAC/tenant ici (du
// ressort de la route appelante, même discipline que final-decision.ts).
export async function lireCandidateProposal(id: string) {
  return prisma.candidateProposal.findUnique({ where: { id } });
}

export async function listerCandidateProposalsDemandeTalent(demandeTalentId: string) {
  return prisma.candidateProposal.findMany({
    where: { demandeTalentId },
    orderBy: { createdAt: "asc" },
    // A36.6 — ajout additif de la Mission déjà créée (si existante), pour
    // que l'UI Admin sache sans appel supplémentaire si l'action de
    // création reste disponible pour une proposition ACCEPTEE. Ne change
    // aucun champ existant de la réponse, n'en retire aucun.
    include: { missionCreee: { select: { id: true } } },
  });
}
