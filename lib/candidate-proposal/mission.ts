import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculerStatutEffectif, CandidateProposalIntrouvableError } from "@/lib/candidate-proposal/proposal";

// ATLAS CANDIDATE PROPOSAL (A35.8) — anti-double-Mission, voir
// docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §7
// (LOCKED A35/A35.1 D2, corrigé A35.6/F3, audité A35.7 PASS). Appelé
// exclusivement depuis l'extension de POST /api/missions (§10.8) — jamais
// une nouvelle route de création de Mission.

export class PropositionNonAccepteeError extends Error {
  constructor() {
    super("PROPOSITION_NON_ACCEPTEE");
  }
}

export class MissionConflitParametresError extends Error {
  constructor() {
    super("MISSION_CONFLIT_PARAMETRES");
  }
}

// A36.6 — décision architecturale A36.5 : "profilId" n'est plus un paramètre
// externe, il est résolu exclusivement côté serveur depuis la chaîne de FK
// non-nullables, `onDelete: Restrict` à chaque saut, déjà validée en A36.5
// (prisma/schema.prisma — CandidateProposal.candidateFinalDecisionEntreeId
// -> CandidateFinalDecisionEntree.candidateSelectionId ->
// CandidateSelection.shortlistEntreeId -> ShortlistEntree.profilId). Un
// "profilId" fourni par l'appelant (navigateur ou tout autre client HTTP) ne
// peut plus déterminer quel Profil reçoit la Mission — voir résolution dans
// `creerOuReprendreMission`/`recupererApresP2002` ci-dessous.
export class ChaineIdentiteCandidatRompueError extends Error {
  constructor() {
    super("CHAINE_IDENTITE_CANDIDAT_ROMPUE");
  }
}

export type MissionDepuisPropositionParams = {
  candidateProposalId: string;
  nbJours: number;
  tjmVente: number;
  deviseVente: string;
  repere?: string | null;
  margeCible?: number;
  dateDebut?: Date | null;
  dateFin?: Date | null;
  modeTravail?: string | null;
};

type MissionParamsDeterminants = { profilId: string; nbJours: number; tjmVente: number; clientId: string };

function parametresIdentiques(a: MissionParamsDeterminants, b: MissionParamsDeterminants): boolean {
  return a.profilId === b.profilId && a.nbJours === b.nbJours && a.tjmVente === b.tjmVente && a.clientId === b.clientId;
}

// Inclusion Prisma unique pour la chaîne d'identité candidat validée en
// A36.5 — jamais une requête séparée par maillon.
const INCLUSION_CHAINE_IDENTITE = {
  candidateFinalDecisionEntree: {
    include: { candidateSelection: { include: { shortlistEntree: { select: { profilId: true } } } } },
  },
} as const;

function resoudreProfilIdDepuisChaine(proposition: {
  candidateFinalDecisionEntree: { candidateSelection: { shortlistEntree: { profilId: string } } } | null;
}): string | null {
  return proposition.candidateFinalDecisionEntree?.candidateSelection?.shortlistEntree?.profilId ?? null;
}

const MAX_TENTATIVES = 3;

async function creerOuReprendreMission(tx: Prisma.TransactionClient, params: MissionDepuisPropositionParams) {
  // 2. Précondition — état effectif ACCEPTEE (jamais une revérification de
  // fraîcheur de la décision source ici, cf. IC §7.2.2, corrigé A35.4/F5).
  // Chargée avec la chaîne d'identité candidat en une seule requête (A36.6).
  const proposition = await tx.candidateProposal.findUnique({
    where: { id: params.candidateProposalId },
    include: INCLUSION_CHAINE_IDENTITE,
  });
  if (!proposition) throw new CandidateProposalIntrouvableError();
  if (calculerStatutEffectif(proposition, new Date()) !== "ACCEPTEE") throw new PropositionNonAccepteeError();

  // A36.6 — profilId résolu exclusivement depuis la chaîne existante,
  // jamais depuis un paramètre externe (décision A36.5). Chaque maillon est
  // protégé onDelete:Restrict : un résultat vide ici signale un état
  // interne incohérent, jamais un cas d'usage normal — échec explicite,
  // aucune valeur inventée.
  const profilId = resoudreProfilIdDepuisChaine(proposition);
  if (!profilId) throw new ChaineIdentiteCandidatRompueError();

  // 3.a Relire s'il existe déjà une Mission pour cette proposition.
  const existante = await tx.mission.findUnique({ where: { sourceCandidateProposalId: params.candidateProposalId } });
  const demandes: MissionParamsDeterminants = { profilId, nbJours: params.nbJours, tjmVente: params.tjmVente, clientId: proposition.clientId };

  if (existante) {
    // 3.c
    if (parametresIdentiques(existante, demandes)) return { mission: existante, mutationReelle: false };
    throw new MissionConflitParametresError();
  }

  // 3.b — needVersionId/solutionDecisionId toujours null (invariant 17) ;
  // clientId et profilId toujours dérivés de la proposition, jamais du body.
  const mission = await tx.mission.create({
    data: {
      clientId: proposition.clientId,
      profilId,
      nbJours: params.nbJours,
      tjmVente: params.tjmVente,
      deviseVente: params.deviseVente,
      repere: params.repere ?? null,
      margeCible: params.margeCible ?? 0.3,
      dateDebut: params.dateDebut ?? null,
      dateFin: params.dateFin ?? null,
      modeTravail: params.modeTravail ?? null,
      needVersionId: null,
      solutionDecisionId: null,
      sourceCandidateProposalId: params.candidateProposalId,
    },
  });
  return { mission, mutationReelle: true };
}

// Inspecte `erreur.meta?.target` sans jamais supposer une représentation
// unique (tableau de colonnes, chaîne, ou absent selon la version
// Prisma/le connecteur — corrigé A35.6/F3, précisément repris A35.8 §6.1).
function cibleContientSourceCandidateProposalId(target: unknown): boolean {
  if (Array.isArray(target)) return target.some((t) => typeof t === "string" && t.includes("sourceCandidateProposalId"));
  if (typeof target === "string") return target.includes("sourceCandidateProposalId");
  return false;
}

async function recupererApresP2002(erreur: Prisma.PrismaClientKnownRequestError, params: MissionDepuisPropositionParams) {
  // 4/5/9 — ne jamais assimiler tout P2002 à un conflit de provenance ; si
  // la contrainte n'est pas identifiée avec certitude, ne jamais fabriquer
  // un succès idempotent, propager l'erreur telle quelle.
  if (!cibleContientSourceCandidateProposalId(erreur.meta?.target)) {
    throw erreur;
  }

  // 6 — rollback déjà acté (transaction avortée) ; relecture hors de
  // l'écriture en échec, via le client Prisma plein (jamais la même tx).
  const proposition = await prisma.candidateProposal.findUnique({
    where: { id: params.candidateProposalId },
    include: INCLUSION_CHAINE_IDENTITE,
  });
  const existante = await prisma.mission.findUnique({ where: { sourceCandidateProposalId: params.candidateProposalId } });

  const profilId = proposition ? resoudreProfilIdDepuisChaine(proposition) : null;
  if (!existante || !proposition || !profilId) {
    // 9 — aucune Mission correspondante trouvée malgré le P2002, ou chaîne
    // d'identité introuvable à la relecture : ne jamais masquer, remonter
    // l'erreur inattendue.
    throw erreur;
  }

  const demandes: MissionParamsDeterminants = { profilId, nbJours: params.nbJours, tjmVente: params.tjmVente, clientId: proposition.clientId };
  // 7
  if (parametresIdentiques(existante, demandes)) return { mission: existante, mutationReelle: false };
  // 8
  throw new MissionConflitParametresError();
}

export async function creerOuReprendreMissionAvecRetry(params: MissionDepuisPropositionParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerOuReprendreMission(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        // 1/3 — distinct du traitement P2002 : un P2034 reste relancé par
        // la boucle, jamais traité comme un conflit de provenance.
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") return await recupererApresP2002(erreur, params);
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_MISSION_CANDIDATE_PROPOSAL_CONCURRENCE");
}
