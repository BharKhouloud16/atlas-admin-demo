import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { suggererCriteresDemande, evaluerEligibiliteBesoin } from "@/lib/client-need/talent-bridge";
import { classerProfils, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireRecommandation } from "@/lib/talent/recommendation-engine";
import { adapterEnOptionClient } from "./adapter";
import { comparerOptions } from "./comparaison";
import { calculerSignatureSource } from "./signature";
import type { DonneesSolutionOption, SolutionOptionVue } from "./persistence-types";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — génération.
//
// Orchestration IMPURE (Prisma, lib/talent/* en lecture seule) — toute la
// logique de décision reste dans les fonctions PURES de V2.1-B
// (adapterEnOptionClient, comparerOptions) et V2.1-A (SolutionOption). Ce
// fichier ne fait que : lire ClientNeed, résoudre ses critères actuels
// (réutilise dernierFaitParCle/suggererCriteresDemande, LOT 3/5 — jamais
// une deuxième logique d'extraction), appeler le Matching V2 EXISTANT en
// lecture seule (classerProfils, jamais modifié), adapter/comparer, puis
// persister — jamais l'inverse.
//
// Nombre d'options Client-facing volontairement plus restreint que la
// shortlist Admin (10, voir app/api/talent/demandes/[id]/recommandations/
// route.ts) — un Client compare 2 à 5 solutions, pas une liste de
// candidats à trier (voir revue UX V2.1-D : "ne pas surcharger l'écran").
const NOMBRE_OPTIONS_CLIENT_MAX = 5;

export type ResultatGeneration =
  | { eligible: false; raison: string; options: []; recommandation: null }
  | { eligible: true; options: SolutionOptionVue[]; recommandation: SolutionOptionVue | null };

function donneesVersJson(donnees: DonneesSolutionOption): Prisma.InputJsonValue {
  return donnees as unknown as Prisma.InputJsonValue;
}

export function ligneVersVue(ligne: {
  id: string;
  niveau: string;
  typeSolution: string;
  titre: string;
  justification: string;
  donnees: Prisma.JsonValue;
  sourceOptionId: string | null;
  decideParEmail: string | null;
  decideLe: Date | null;
  createdAt: Date;
}): SolutionOptionVue {
  const donnees = ligne.donnees as unknown as DonneesSolutionOption;
  return {
    id: ligne.id,
    niveau: ligne.niveau as SolutionOptionVue["niveau"],
    typeSolution: "TALENT",
    titre: ligne.titre,
    justification: ligne.justification,
    competencesCorrespondantes: donnees.competencesCorrespondantes,
    niveauConfiance: donnees.niveauConfiance,
    criteresAPreciser: donnees.criteresAPreciser,
    disponibilite: donnees.disponibilite,
    sourceOptionId: ligne.sourceOptionId,
    decideParEmail: ligne.decideParEmail,
    decideLe: ligne.decideLe ? ligne.decideLe.toISOString() : null,
    createdAt: ligne.createdAt.toISOString(),
  };
}

// Reproduit la même requête que app/api/talent/demandes/[id]/recommandations/
// route.ts (profils au dossier exploitable, Skill Graph, missions/
// évaluations groupés — aucun N+1) : logique non exportée par cette route
// (handler de route, pas un module réutilisable), donc réécrite ici à
// l'identique plutôt que dupliquée en important un fichier app/api/*. La
// LOGIQUE elle-même (classerProfils, Candidate/Talent Intelligence,
// construireRecommandation) reste importée, jamais réimplémentée.
async function chargerCandidatsEtRecommander(criteres: {
  competencesRecherchees: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
  anneesExperienceMin: number | null;
  localisation: string | null;
  disponibiliteSouhaitee: string | null;
}) {
  const profils = await prisma.profil.findMany({
    where: { cvValide: true },
    select: {
      id: true,
      nom: true,
      prenom: true,
      competences: true,
      seniorite: true,
      disponibilite: true,
      cvValide: true,
      tjmEstime: true,
      anneesExperience: true,
      paysResidence: true,
    },
  });
  const profilIds = profils.map((p) => p.id);

  const lignesSkillGraph = await prisma.profilCompetence.findMany({
    where: { profilId: { in: profilIds } },
    include: { preuves: { orderBy: { createdAt: "asc" } } },
  });
  const graphParProfil = new Map<string, CompetenceGraphPourMatching[]>();
  const graphIntelligenceParProfil = new Map<string, ProfilPourIntelligence["competencesGraph"]>();
  for (const ligne of lignesSkillGraph) {
    const pourMatching = graphParProfil.get(ligne.profilId) ?? [];
    pourMatching.push({
      competence: ligne.competence,
      statut: ligne.statut,
      niveau: ligne.niveau,
      confiance: ligne.confiance,
      anneesExperience: ligne.anneesExperience,
      contexte: ligne.contexte,
      provenancePrincipale: ligne.preuves.length > 0 ? ligne.preuves[ligne.preuves.length - 1].source : null,
    });
    graphParProfil.set(ligne.profilId, pourMatching);

    const pourIntelligence = graphIntelligenceParProfil.get(ligne.profilId) ?? [];
    pourIntelligence.push({
      competence: ligne.competence,
      statut: ligne.statut,
      niveau: ligne.niveau,
      confiance: ligne.confiance,
      contexte: ligne.contexte,
      preuves: ligne.preuves.map((p) => ({ source: p.source, detail: p.detail, createdAt: p.createdAt, niveau: p.niveau })),
    });
    graphIntelligenceParProfil.set(ligne.profilId, pourIntelligence);
  }

  const missionsParProfil = await prisma.mission.findMany({
    where: { profilId: { in: profilIds } },
    include: { evaluation: true },
  });
  const missionsMap = new Map<string, typeof missionsParProfil>();
  for (const m of missionsParProfil) {
    const liste = missionsMap.get(m.profilId) ?? [];
    liste.push(m);
    missionsMap.set(m.profilId, liste);
  }

  const profilsAvecSkillGraph: ProfilPourMatching[] = profils.map((p) => ({
    ...p,
    competencesGraph: graphParProfil.get(p.id) ?? [],
  }));

  const classement = classerProfils(profilsAvecSkillGraph, {
    competencesRecherchees: criteres.competencesRecherchees,
    senioriteSouhaitee: criteres.senioriteSouhaitee,
    budgetTjmMax: criteres.budgetTjmMax,
    anneesExperienceMin: criteres.anneesExperienceMin ?? undefined,
    disponibiliteSouhaitee: criteres.disponibiliteSouhaitee ?? undefined,
    localisation: criteres.localisation ?? undefined,
  });

  const top = classement.slice(0, NOMBRE_OPTIONS_CLIENT_MAX);
  const profilsParId = new Map(profils.map((p) => [p.id, p]));

  return top.map((resultatMatching) => {
    const profil = profilsParId.get(resultatMatching.profilId)!;
    const missions = missionsMap.get(profil.id) ?? [];
    const entree: ProfilPourIntelligence = {
      id: profil.id,
      nom: profil.nom,
      prenom: profil.prenom,
      anneesExperience: profil.anneesExperience,
      seniorite: profil.seniorite,
      disponibilite: profil.disponibilite,
      paysResidence: profil.paysResidence,
      cvValide: profil.cvValide,
      competencesDeclarees: profil.competences,
      competencesGraph: graphIntelligenceParProfil.get(profil.id) ?? [],
      missions: missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, secteur: null, createdAt: m.createdAt })),
      evaluations: missions.filter((m) => m.evaluation).map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt })),
    };
    const candidateIntelligence = construireCandidateIntelligence(entree);
    const talentIntelligence = construireTalentIntelligence(candidateIntelligence);
    const recommandation = construireRecommandation(resultatMatching, candidateIntelligence, talentIntelligence, criteres.competencesRecherchees);
    return { recommandation, disponibiliteBrute: profil.disponibilite };
  });
}

const MAX_TENTATIVES_SERIALISATION = 3;

// Point d'entrée principal — idempotent (même besoin + mêmes critères
// résolus = pas de nouvelle génération, voir signature.ts) et sûr en
// concurrence (transaction Serializable + nouvelle tentative sur conflit
// d'écriture Postgres — jamais de doublon même sur deux requêtes
// simultanées).
export async function genererOuRecupererSolutions(needId: string, clientId: string): Promise<ResultatGeneration> {
  for (let tentative = 0; tentative < MAX_TENTATIVES_SERIALISATION; tentative++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const need = await tx.clientNeed.findFirst({ where: { id: needId, clientId }, include: { faits: true } });
          if (!need) throw new Error("BESOIN_INTROUVABLE");

          const eligibilite = evaluerEligibiliteBesoin(need);
          if (!eligibilite.eligible) {
            return { eligible: false, raison: eligibilite.raison!, options: [], recommandation: null } as const;
          }

          const criteres = suggererCriteresDemande(need.faits);
          const signature = calculerSignatureSource(criteres);

          const derniereRecommandation = await tx.solutionOption.findFirst({
            where: { needId, niveau: "RECOMMANDATION" },
            orderBy: { createdAt: "desc" },
          });

          const signatureActuelle =
            derniereRecommandation && (derniereRecommandation.donnees as unknown as DonneesSolutionOption).signatureSource;

          if (derniereRecommandation && signatureActuelle === signature) {
            // Rien n'a changé depuis la dernière génération — on renvoie
            // l'état existant, jamais une nouvelle ligne (idempotence).
            const lignes = await tx.solutionOption.findMany({ where: { needId }, orderBy: { createdAt: "asc" } });
            const vues = lignes.map(ligneVersVue);
            return {
              eligible: true,
              options: vues.filter((v) => v.niveau === "OPTION"),
              recommandation: vues.find((v) => v.id === derniereRecommandation.id) ?? null,
            } as const;
          }

          // Source différente (ou première génération) — nouvelle vague
          // append-only, jamais un écrasement des lignes précédentes.
          const candidats = await chargerCandidatsEtRecommander({
            competencesRecherchees: criteres.competencesExtraites.map((c) => c.valeur),
            senioriteSouhaitee: criteres.senioriteSouhaitee?.valeur ?? null,
            budgetTjmMax: criteres.budgetTjmMax?.valeur ?? null,
            anneesExperienceMin: criteres.anneesExperienceMin?.valeur ?? null,
            localisation: criteres.localisation?.valeur ?? null,
            disponibiliteSouhaitee: criteres.disponibiliteSouhaitee?.valeur ?? null,
          });

          const optionsClientSafe = candidats.map((c) => adapterEnOptionClient(c.recommandation, c.disponibiliteBrute));
          const resultatComparaison = comparerOptions(optionsClientSafe);

          if (resultatComparaison.optionsOrdonnees.length === 0) {
            // Aucun candidat exploitable — jamais une option inventée.
            return { eligible: true, options: [], recommandation: null } as const;
          }

          const lignesCreees: { id: string; rang: number }[] = [];
          for (const option of resultatComparaison.optionsOrdonnees) {
            const donnees: DonneesSolutionOption = {
              signatureSource: signature,
              competencesCorrespondantes: option.competencesCorrespondantes,
              niveauConfiance: option.niveauConfiance,
              rationale: option.rationale,
              criteresAPreciser: option.criteresAPreciser,
              disponibilite: option.disponibilite,
            };
            const ligne = await tx.solutionOption.create({
              data: {
                needId,
                clientId,
                niveau: "OPTION",
                typeSolution: "TALENT",
                titre: option.competencesCorrespondantes.length > 0 ? option.competencesCorrespondantes.join(", ") : "Option de solution",
                justification: option.rationale.join(" "),
                donnees: donneesVersJson(donnees),
              },
            });
            lignesCreees.push({ id: ligne.id, rang: option.rang });
          }

          let ligneRecommandation: Awaited<ReturnType<typeof tx.solutionOption.create>> | null = null;
          if (resultatComparaison.recommandation) {
            const optionSource = lignesCreees.find((l) => l.rang === resultatComparaison.recommandation!.rangRecommande);
            const donnees: DonneesSolutionOption = {
              signatureSource: signature,
              competencesCorrespondantes: resultatComparaison.recommandation.criteresDeterminants,
              niveauConfiance: resultatComparaison.recommandation.niveauConfiance,
              rationale: [],
              criteresAPreciser: resultatComparaison.recommandation.inconnuesImportantes,
              disponibilite: resultatComparaison.optionsOrdonnees[resultatComparaison.recommandation.rangRecommande - 1].disponibilite,
              criteresDeterminants: resultatComparaison.recommandation.criteresDeterminants,
              inconnuesImportantes: resultatComparaison.recommandation.inconnuesImportantes,
              rangsAlternativesEquivalentes: resultatComparaison.recommandation.rangsAlternativesEquivalentes,
            };
            ligneRecommandation = await tx.solutionOption.create({
              data: {
                needId,
                clientId,
                niveau: "RECOMMANDATION",
                typeSolution: "TALENT",
                titre: "Solution recommandée",
                justification: resultatComparaison.recommandation.justification,
                donnees: donneesVersJson(donnees),
                sourceOptionId: optionSource?.id ?? null,
              },
            });
          }

          const toutesLesLignes = await tx.solutionOption.findMany({
            where: { id: { in: [...lignesCreees.map((l) => l.id), ...(ligneRecommandation ? [ligneRecommandation.id] : [])] } },
            orderBy: { createdAt: "asc" },
          });
          const vues = toutesLesLignes.map(ligneVersVue);

          return {
            eligible: true,
            options: vues.filter((v) => v.niveau === "OPTION"),
            recommandation: ligneRecommandation ? vues.find((v) => v.id === ligneRecommandation!.id) ?? null : null,
          } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES_SERIALISATION - 1) {
        continue; // une autre requête concurrente a déjà généré — on relit à la tentative suivante, jamais un doublon
      }
      if (erreur instanceof Error && erreur.message === "BESOIN_INTROUVABLE") throw erreur;
      throw erreur;
    }
  }
  throw new Error("ÉCHEC_GÉNÉRATION_CONCURRENCE");
}

// Lecture seule — utilisée par la route Admin (GET .../talent/besoins/[id]/
// solutions), qui n'a pas vocation à déclencher une génération (réservé au
// parcours Client, seul déclencheur légitime).
export async function listerSolutionsExistantes(needId: string): Promise<SolutionOptionVue[]> {
  const lignes = await prisma.solutionOption.findMany({ where: { needId }, orderBy: { createdAt: "asc" } });
  return lignes.map(ligneVersVue);
}
