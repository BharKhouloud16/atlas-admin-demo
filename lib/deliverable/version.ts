import { Prisma } from "@prisma/client";
import type { DeliverableNatureContenu, DeliverableStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DeliverableIntrouvableError, TitreInvalideError, ContenuStructureInvalideError, validerContenuStructure } from "@/lib/deliverable/deliverable";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026) — DeliverableVersion.
//
// RÈGLE ABSOLUE (contrat A25 §13/§15/§18/§40/§41) : une version n'est
// JAMAIS réécrite — ni son contenu (titre/natureContenu/contenuStructure,
// immuables dès la création, aucune route d'édition n'existe pour eux),
// ni son identité de succession (version/supersedesId/createdAt/
// createdByEmail). Correction = toujours une nouvelle ligne. Le pointeur
// de succession vit sur la NOUVELLE ligne (supersedesId), jamais sur
// l'ancienne — même doctrine que OutcomeAssessment (A15) — @unique sur
// supersedesId empêchant structurellement tout branchement.
//
// MISSION CLOSE : cette fonction ne vérifie JAMAIS Mission.statut
// (contrat A25 §34/§35, décision explicite) — "TERMINEE bloque la
// création de nouveau travail, mais ne détruit pas la possibilité de
// corriger/versionner historiquement un livrable existant lorsque cela
// est nécessaire à l'évaluation ou à la conformité." Seule la création
// d'un NOUVEAU Deliverable (lib/deliverable/deliverable.ts) est gelée par
// Mission.statut — jamais une nouvelle version d'un Deliverable déjà
// existant, quel que soit le statut Mission.

export class VersionIntrouvableError extends Error {
  constructor() {
    super("VERSION_INTROUVABLE");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: DeliverableStatut, public readonly vers: DeliverableStatut) {
    super("TRANSITION_INVALIDE");
  }
}

// Matrice de transitions explicite — même discipline que
// lib/mission/lifecycle.ts/lib/work-item/lifecycle.ts : une table pure,
// jamais un enchaînement de `if` dispersés. FINALIZED et REJECTED sont
// TOUS LES DEUX terminaux (contrat A25 §16/§21 : aucune réouverture
// REJECTED->DRAFT — "une correction crée une nouvelle version", jamais
// une réécriture/réouverture).
export const TRANSITIONS_AUTORISEES: Record<DeliverableStatut, DeliverableStatut[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["FINALIZED"],
  FINALIZED: [],
  REJECTED: [],
};

export function transitionAutorisee(depuis: DeliverableStatut, vers: DeliverableStatut): boolean {
  return TRANSITIONS_AUTORISEES[depuis].includes(vers);
}

export type ActionLifecycleDeliverable = "soumettre" | "approuver" | "finaliser" | "rejeter";

const CIBLE_PAR_ACTION: Record<ActionLifecycleDeliverable, DeliverableStatut> = {
  soumettre: "REVIEW",
  approuver: "APPROVED",
  finaliser: "FINALIZED",
  rejeter: "REJECTED",
};

export type CreationVersionParams = {
  deliverableId: string;
  titre: string;
  natureContenu: DeliverableNatureContenu;
  contenuStructure?: unknown;
  createdByEmail: string;
};

// Même invariant croisé que OutcomeAssessment/A15 : "au plus une ligne
// courante (supersededBy IS NULL) par Deliverable" — Serializable + retry,
// relecture DANS la transaction, jamais une vérification préalable hors
// transaction suivie d'une écriture séparée (garantit qu'une course entre
// deux créations concurrentes ne produit jamais V1->{V2,V3}, contrat
// A25 §42 : l'une des deux transactions perd la course de sérialisation
// Postgres, retry, relit la VRAIE version courante, devient V3 — jamais
// un second V2).
async function creerVersion(tx: Prisma.TransactionClient, params: CreationVersionParams) {
  const deliverable = await tx.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true } });
  if (!deliverable) throw new DeliverableIntrouvableError();

  const titre = titreNormaliseVersion(params.titre);
  const contenuStructure = validerContenuStructure(params.natureContenu, params.contenuStructure);

  const courant = await tx.deliverableVersion.findFirst({
    where: { deliverableId: params.deliverableId, supersededBy: null },
    select: { id: true, version: true },
  });

  return tx.deliverableVersion.create({
    data: {
      deliverableId: params.deliverableId,
      version: (courant?.version ?? 0) + 1,
      titre,
      natureContenu: params.natureContenu,
      contenuStructure: contenuStructure ?? Prisma.JsonNull,
      supersedesId: courant?.id ?? null,
      createdByEmail: params.createdByEmail,
    },
  });
}

function titreNormaliseVersion(titre: unknown): string {
  if (typeof titre !== "string") throw new TitreInvalideError();
  const normalise = titre.trim();
  if (normalise.length === 0) throw new TitreInvalideError();
  return normalise;
}

const MAX_TENTATIVES = 3;

export async function creerVersionAvecRetry(params: CreationVersionParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerVersion(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_DELIVERABLE_VERSION_CONCURRENCE");
}

export async function listerVersionsDeliverable(deliverableId: string) {
  return prisma.deliverableVersion.findMany({ where: { deliverableId }, orderBy: { version: "asc" } });
}

export type LectureVersionParams = {
  versionId: string;
  deliverableId: string;
};

export async function lireVersion(params: LectureVersionParams) {
  const version = await prisma.deliverableVersion.findUnique({ where: { id: params.versionId } });
  if (!version || version.deliverableId !== params.deliverableId) throw new VersionIntrouvableError();
  return version;
}

export type ParamsTransitionVersion = {
  versionId: string;
  deliverableId: string;
  action: ActionLifecycleDeliverable;
  raison?: string | null; // "rejeter" uniquement — optionnel, jamais inventé (contrat A25 §32 : aucun catalogue supplémentaire sans justification), journalisé si fourni.
};

// COMPANY ATLAS — A25 : moteur de transition DeliverableVersion.
//
// RÈGLE ABSOLUE (contrat A25 §28/§29/§30/§31/§32) : cette fonction ne
// crée/modifie JAMAIS OutcomeAssessment, ni Quality/Evidence (domaines
// hors périmètre A25) — FINALIZED ne déclenche aucune cascade.
//
// CONCURRENCE : contrairement à la CRÉATION ci-dessus, une transition ne
// porte aucun invariant croisé entre lignes (le statut d'UNE version
// précise, jamais une unicité à vérifier contre d'autres lignes) — même
// discipline que lib/mission/lifecycle.ts/lib/work-item/lifecycle.ts :
// écriture conditionnelle en une seule instruction (`updateMany` avec le
// statut de départ observé en clause WHERE), jamais une transaction
// Serializable ici.
export async function executerTransitionVersion(params: ParamsTransitionVersion) {
  const version = await prisma.deliverableVersion.findUnique({ where: { id: params.versionId } });
  if (!version || version.deliverableId !== params.deliverableId) throw new VersionIntrouvableError();

  const statutDepart = version.statut;
  const statutCible = CIBLE_PAR_ACTION[params.action];

  if (!transitionAutorisee(statutDepart, statutCible)) {
    throw new TransitionInvalideError(statutDepart, statutCible);
  }

  const ecriture = await prisma.deliverableVersion.updateMany({
    where: { id: params.versionId, statut: statutDepart },
    data: { statut: statutCible },
  });
  if (ecriture.count === 0) {
    // Stale : une autre transition a déjà changé ce statut entre la
    // lecture et cette écriture — jamais un écrasement.
    throw new TransitionInvalideError(statutDepart, statutCible);
  }

  return prisma.deliverableVersion.findUniqueOrThrow({ where: { id: params.versionId } });
}

export { ContenuStructureInvalideError };
