import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deriverCapacites, type FaitPourCapacite } from "./engine";

// COMPANY ATLAS — A8 : Capability Engine V1 — couche de persistance.
//
// Même discipline d'isolation que le reste de l'Espace Client :
// `clientId` toujours dérivé de la session côté route, jamais du corps ;
// un besoin d'un autre client renvoie BESOIN_INTROUVABLE (-> 404, jamais
// une fuite d'existence).
//
// Idempotence (mandat A8 §12) : la contrainte @@unique([needVersionId,
// sourceFaitId]) est la clé naturelle — on calcule l'ensemble désiré
// (depuis les faits ACTIFS actuels), on diffe contre l'ensemble déjà
// persisté, on n'insère que la différence. Jamais un hash séparé à
// maintenir.
//
// Fail-closed (mandat A8 §13/C7) : si un sourceFaitId déjà persisté ne
// correspond plus à un fait COMPETENCE actuellement ACTIF (fait repassé
// OBSOLETE, ou disparu), la ligne CapabilityRequirement existante est
// marquée SUPERSEDED — jamais laissée silencieusement ACTIVE pour une
// source qui n'est plus vérifiable.

export type CapabilityRequirementVue = {
  id: string;
  needVersionId: string;
  solutionDecisionId: string | null;
  sourceFaitId: string;
  requiredCapability: string;
  rationale: string;
  provenance: string;
  status: string;
  createdAt: string;
};

export type ResultatCapacites =
  | { statut: "NO_CAPABILITY_DERIVABLE"; capabilities: [] }
  | { statut: "DERIVEES"; capabilities: CapabilityRequirementVue[] };

export class BesoinIntrouvableError extends Error {
  constructor() {
    super("BESOIN_INTROUVABLE");
  }
}

export class VersionNonCouranteError extends Error {
  constructor() {
    super("VERSION_NON_COURANTE");
  }
}

function ligneVersVue(ligne: {
  id: string;
  needVersionId: string;
  solutionDecisionId: string | null;
  sourceFaitId: string;
  requiredCapability: string;
  rationale: string;
  provenance: string;
  status: string;
  createdAt: Date;
}): CapabilityRequirementVue {
  return {
    id: ligne.id,
    needVersionId: ligne.needVersionId,
    solutionDecisionId: ligne.solutionDecisionId,
    sourceFaitId: ligne.sourceFaitId,
    requiredCapability: ligne.requiredCapability,
    rationale: ligne.rationale,
    provenance: ligne.provenance,
    status: ligne.status,
    createdAt: ligne.createdAt.toISOString(),
  };
}

// Résolution en lecture de la SolutionDecision courante pour ce Need, si
// elle existe — jamais une précondition bloquante (la dérivation
// fonctionne depuis le Need seul). Vocabulaire domaine `SolutionDecision`,
// aucun rapport avec `Decision`/`DecisionOption` du Control Plane (voir
// lib/client-solution/decision.ts).
async function resoudreSolutionDecisionCourante(needId: string): Promise<string | null> {
  const decision = await prisma.solutionOption.findFirst({
    where: { needId, niveau: "DECISION" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return decision?.id ?? null;
}

async function chargerNeedPourClient(needId: string, clientId: string) {
  const besoin = await prisma.clientNeed.findFirst({
    where: { id: needId, clientId },
    include: { faits: true },
  });
  return besoin;
}

// GET /api/client/besoins/[id]/capabilities — déclenche (ou récupère, si
// déjà à jour, idempotent) la dérivation. Même patron exact que
// genererOuRecupererSolutions (lib/client-solution/generation.ts).
export async function genererOuRecupererCapacites(needId: string, clientId: string): Promise<ResultatCapacites> {
  const besoin = await chargerNeedPourClient(needId, clientId);
  if (!besoin) throw new BesoinIntrouvableError();
  if (besoin.needSuivantId !== null) throw new VersionNonCouranteError();

  const faitsPourMoteur: FaitPourCapacite[] = besoin.faits.map((f) => ({
    id: f.id,
    cle: f.cle,
    valeur: f.valeur,
    statut: f.statut,
    statutActivite: f.statutActivite,
  }));

  const derivation = deriverCapacites(faitsPourMoteur);

  const sourceFaitIdsActifs = new Set(derivation.capacites.map((c) => c.sourceFaitId));

  const existantes = await prisma.capabilityRequirement.findMany({
    where: { needVersionId: needId },
  });
  const sourceFaitIdsExistants = new Set(existantes.map((e) => e.sourceFaitId));

  // Fail-closed : toute ligne ACTIVE dont le fait source n'est plus parmi
  // les COMPETENCE actuellement actifs passe en SUPERSEDED — jamais
  // laissée silencieusement ACTIVE pour une source devenue obsolète ou
  // disparue (mandat A8 §13/C7).
  const aSuperseder = existantes.filter((e) => e.status === "ACTIVE" && !sourceFaitIdsActifs.has(e.sourceFaitId));
  if (aSuperseder.length > 0) {
    await prisma.capabilityRequirement.updateMany({
      where: { id: { in: aSuperseder.map((e) => e.id) } },
      data: { status: "SUPERSEDED" },
    });
  }

  const aCreer = derivation.capacites.filter((c) => !sourceFaitIdsExistants.has(c.sourceFaitId));

  if (aCreer.length > 0) {
    const solutionDecisionId = await resoudreSolutionDecisionCourante(needId);
    await prisma.capabilityRequirement.createMany({
      data: aCreer.map((c) => ({
        needVersionId: needId,
        solutionDecisionId,
        sourceFaitId: c.sourceFaitId,
        requiredCapability: c.requiredCapability,
        rationale: c.rationale,
        provenance: c.provenance as Prisma.CapabilityRequirementCreateManyInput["provenance"],
      })),
      skipDuplicates: true,
    });
  }

  if (derivation.statut === "NO_CAPABILITY_DERIVABLE") {
    return { statut: "NO_CAPABILITY_DERIVABLE", capabilities: [] };
  }

  const lignes = await prisma.capabilityRequirement.findMany({
    where: { needVersionId: needId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return { statut: "DERIVEES", capabilities: lignes.map(ligneVersVue) };
}

// GET /api/talent/besoins/[id]/capabilities — lecture pure, ne dérive
// jamais (même patron exact que listerSolutionsExistantes). Vue transverse
// Admin (pas d'isolation clientId).
export async function listerCapacitesExistantes(needId: string): Promise<CapabilityRequirementVue[]> {
  const lignes = await prisma.capabilityRequirement.findMany({
    where: { needVersionId: needId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return lignes.map(ligneVersVue);
}
