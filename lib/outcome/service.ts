import { Prisma } from "@prisma/client";
import type { OutcomeMethodeVerification, OutcomeStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resoudreFaitsActifsPourCopie } from "@/lib/client-need/faits";
import { verifierResultatVsNeed, type CritereEnEntree, type PreuveEnEntree } from "./verification";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Couche DB au-dessus de la fonction pure verifierResultatVsNeed() —
// même séparation que lib/client-need/versioning.ts (fork pur vs route
// API) : cette fonction fait le travail de résolution/écriture, la route
// API reste responsable de l'authentification/RBAC/ownership.
//
// RÈGLE STRUCTURELLE (mandat A6.1 §15, implémentée ici et non seulement
// documentée) : l'ensemble des critères évalués est TOUJOURS construit à
// partir des ClientNeedFait(CRITERE_REUSSITE) RÉELLEMENT actifs sur la
// version du Need pinnée — jamais à partir de ce que l'appelant prétend
// avoir évalué. Un critère que l'ADMIN n'a pas renseigné dans sa
// soumission est automatiquement inclus avec zéro preuve (=> INDETERMINABLE
// via verifierResultatVsNeed), jamais silencieusement omis — ce qui
// empêcherait un overallStatus=OBTENU fondé sur une évaluation partielle
// non exhaustive.

export type VerdictCritereSaisi = {
  sourceFaitId: string;
  statutPropose: OutcomeStatut;
  methodes: OutcomeMethodeVerification[];
  evidences: PreuveEnEntree[];
};

export class CritereInconnuError extends Error {
  constructor(sourceFaitId: string) {
    super(`CRITERE_INCONNU:${sourceFaitId}`);
  }
}

export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

type MissionAvecChaine = Prisma.MissionGetPayload<{
  include: {
    needVersion: { include: { faits: true } };
    sourceDemande: { include: { sourceNeed: { include: { faits: true } } } };
  };
}>;

// Accepte aussi bien le client Prisma plein (lecture seule, hors
// transaction — voir lireCriteresDisponibles ci-dessous) que le client de
// transaction (écriture, voir creerOutcomeAssessment) : mêmes méthodes de
// lecture utilisées dans les deux cas, jamais de duplication de requête.
type ClientDb = Prisma.TransactionClient | typeof prisma;

async function resoudreContexteMission(db: ClientDb, missionId: string): Promise<MissionAvecChaine | null> {
  return db.mission.findUnique({
    where: { id: missionId },
    include: {
      needVersion: { include: { faits: true } },
      sourceDemande: { include: { sourceNeed: { include: { faits: true } } } },
    },
  });
}

// A18 — Mission Need Pinning (05/10/2026) : PRIORITÉ ABSOLUE au pin explicite
// Mission.needVersionId lorsqu'il est présent — jamais une substitution par
// sourceDemande.sourceNeedId, même si celui-ci pointe vers une autre version
// (une telle incohérence ne peut normalement plus naître à la création
// depuis A18, voir lib/mission/need-pinning.ts::validerPinsMission, mais le
// pin reste prioritaire par construction ici, jamais recalculé ni
// réconcilié silencieusement). Le chemin legacy (sourceDemande ->
// sourceNeed) ne redevient la source qu'en l'ABSENCE totale de pin — c'est
// l'unique rôle qui lui reste désormais (contrat A13). Absent des deux
// côtés : comportement NOT_DETERMINABLE inchangé, c'est le cas de la
// majorité des Mission existantes (voir A6 §A6.7).
async function resoudreNeedPinne(
  mission: MissionAvecChaine
): Promise<{ needVersionId: string | null; expectedOutcome: string | null; criteresDisponibles: { id: string; valeur: string }[] }> {
  const need = mission.needVersion ?? mission.sourceDemande?.sourceNeed ?? null;
  if (!need) return { needVersionId: null, expectedOutcome: null, criteresDisponibles: [] };

  const actifs = resoudreFaitsActifsPourCopie(
    need.faits.map((f) => ({ ...f, createdAt: f.createdAt }))
  );
  const resultatAttendu = actifs.find((f) => f.cle === "RESULTAT_ATTENDU");
  const criteres = actifs.filter((f) => f.cle === "CRITERE_REUSSITE");

  return {
    needVersionId: need.id,
    expectedOutcome: resultatAttendu && resultatAttendu.statut !== "INCONNU" ? resultatAttendu.valeur : null,
    criteresDisponibles: criteres.map((f) => ({ id: f.id, valeur: f.valeur })),
  };
}

// Traçabilité pure (pas de relation Prisma, voir schema.prisma) vers la
// ligne SolutionOption(niveau=DECISION) ayant mené à cette Mission, si
// résolvable — jamais une modification de SolutionOption.
async function resoudreDecisionOptionId(db: ClientDb, mission: MissionAvecChaine): Promise<string | null> {
  if (!mission.sourceDemande) return null;
  const decision = await db.solutionOption.findFirst({
    where: { demandeTalentId: mission.sourceDemande.id, niveau: "DECISION" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return decision?.id ?? null;
}

export type CreationOutcomeParams = {
  missionId: string;
  clientId: string; // propriétaire de la Mission — revérifié ici en plus de l'appelant.
  assessedByEmail: string;
  assessedByRole: string;
  verdicts: VerdictCritereSaisi[];
};

async function creerOutcomeAssessment(tx: Prisma.TransactionClient, params: CreationOutcomeParams) {
  const mission = await resoudreContexteMission(tx, params.missionId);
  if (!mission || mission.clientId !== params.clientId) throw new MissionIntrouvableError();

  const { needVersionId, expectedOutcome, criteresDisponibles } = await resoudreNeedPinne(mission);
  const decisionOptionId = await resoudreDecisionOptionId(tx, mission);

  const verdictsParFait = new Map(params.verdicts.map((v) => [v.sourceFaitId, v]));
  for (const v of params.verdicts) {
    if (!criteresDisponibles.some((c) => c.id === v.sourceFaitId)) throw new CritereInconnuError(v.sourceFaitId);
  }

  // Construction EXHAUSTIVE depuis les critères réellement actifs sur la
  // version pinnée — jamais depuis la seule soumission de l'appelant (voir
  // commentaire d'en-tête).
  const criteresEnEntree: CritereEnEntree[] = criteresDisponibles.map((c) => {
    const verdict = verdictsParFait.get(c.id);
    return {
      sourceFaitId: c.id,
      criterionText: c.valeur,
      statutPropose: verdict?.statutPropose ?? "INDETERMINABLE",
      methodes: verdict?.methodes ?? [],
      evidences: verdict?.evidences ?? [],
    };
  });

  const resultat = verifierResultatVsNeed(criteresEnEntree);

  // A15 — Supersession corrigée (même doctrine que DeliveryEvidence,
  // A12.1) : relecture de la ligne "courante" DANS la transaction avant
  // toute écriture (relecture jamais hors transaction, inchangé), mais le
  // pointeur de succession est désormais posé sur la NOUVELLE ligne
  // (supersedesId) dès sa création — l'ancienne ligne ("courant") n'est
  // plus jamais mutée après coup, aucune exception.
  const courant = await tx.outcomeAssessment.findFirst({
    where: { missionId: params.missionId, supersededBy: null },
    select: { id: true },
  });

  const nouveau = await tx.outcomeAssessment.create({
    data: {
      missionId: params.missionId,
      needVersionId,
      decisionOptionId,
      expectedOutcome,
      overallStatus: resultat.overallStatus,
      assessedByEmail: params.assessedByEmail,
      assessedByRole: params.assessedByRole,
      supersedesId: courant?.id ?? null,
      criteria: {
        create: resultat.criteria.map((c) => ({
          sourceFaitId: c.sourceFaitId,
          criterionText: c.criterionText,
          status: c.status,
          confidence: c.confidence,
          verificationMethod: c.verificationMethod,
          evidences: { create: c.evidences.map((e) => ({ source: e.source, detail: e.detail ?? null })) },
        })),
      },
    },
    include: { criteria: { include: { evidences: true } } },
  });

  return nouveau;
}

const MAX_TENTATIVES = 3;

// Même discipline que lib/client-need/versioning.ts::executerForkAvecRetry
// et lib/client-solution/generation.ts : transaction Serializable, retry
// uniquement sur conflit de sérialisation Postgres (P2034) — garantit
// qu'au plus une ligne "courante" (supersededBy IS NULL) existe par
// Mission même sous deux créations concurrentes (voir tests).
export async function creerOutcomeAssessmentAvecRetry(params: CreationOutcomeParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerOutcomeAssessment(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_OUTCOME_CONCURRENCE");
}

// Lecture seule — expose à l'UI (MissionOutcomePanel) la liste des
// critères réellement disponibles sur la version du Need pinnée, pour que
// l'Admin sache quoi évaluer avant soumission. Même résolution que
// creerOutcomeAssessment, jamais dupliquée en logique séparée.
export async function lireCriteresDisponibles(missionId: string) {
  const mission = await resoudreContexteMission(prisma, missionId);
  if (!mission) throw new MissionIntrouvableError();
  const { needVersionId, expectedOutcome, criteresDisponibles } = await resoudreNeedPinne(mission);
  return { needVersionId, expectedOutcome, criteresDisponibles };
}

// Lecture seule — renvoie la ligne COURANTE (supersededBy IS NULL) de
// la Mission, ou null si aucune évaluation n'a jamais été tentée. Jamais
// confondu avec une ligne existante INDETERMINABLE (voir A6 §A6.12).
export async function lireOutcomeCourant(missionId: string) {
  return prisma.outcomeAssessment.findFirst({
    where: { missionId, supersededBy: null },
    include: { criteria: { include: { evidences: true } } },
    orderBy: { createdAt: "desc" },
  });
}
