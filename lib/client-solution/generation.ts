import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { suggererCriteresDemande, evaluerEligibiliteBesoin } from "@/lib/client-need/talent-bridge";
import { classerProfils, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireRecommandation } from "@/lib/talent/recommendation-engine";
import { adapterEnOptionClient } from "./adapter";
import { evaluerAdmissibilite, comparerAdmissibles, type Admissibilite } from "@/lib/talent/admissibilite";
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

function titreOption(option: { niveauCorrespondance?: "FORTE" | "PARTIELLE"; competencesCorrespondantes: string[] }): string {
  const competences = option.competencesCorrespondantes.join(", ");
  if (option.niveauCorrespondance === "FORTE") return `Correspondance forte — ${competences}`;
  if (option.niveauCorrespondance === "PARTIELLE") return `Correspondance partielle — ${competences}`;
  return competences || "Option de solution";
}

export type ResultatGeneration =
  | { eligible: false; raison: string; options: []; recommandation: null; decisions: [] }
  | { eligible: true; options: SolutionOptionVue[]; recommandation: SolutionOptionVue | null; decisions: SolutionOptionVue[] };

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
    niveauCorrespondance: donnees.niveauCorrespondance ?? null,
    competencesManquantes: donnees.competencesManquantes ?? [],
    niveauConfiance: donnees.niveauConfiance,
    criteresAPreciser: donnees.criteresAPreciser,
    disponibilite: donnees.disponibilite,
    sourceOptionId: ligne.sourceOptionId,
    decideParEmail: ligne.decideParEmail,
    decideLe: ligne.decideLe ? ligne.decideLe.toISOString() : null,
    createdAt: ligne.createdAt.toISOString(),
  };
}

// Profils au dossier exploitable (cvValide) et leur Skill Graph, en deux
// requêtes groupées. Partagé par la génération Client et l'analyse Admin.
async function chargerProfilsEtSkillGraph() {
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

  return { profils, profilIds, graphParProfil, graphIntelligenceParProfil };
}

// Reproduit la même requête que app/api/talent/demandes/[id]/recommandations/
// route.ts (profils au dossier exploitable, Skill Graph, missions/
// évaluations groupés — aucun N+1) : logique non exportée par cette route
// (handler de route, pas un module réutilisable), donc réécrite ici à
// l'identique plutôt que dupliquée en important un fichier app/api/*. La
// LOGIQUE elle-même (classerProfils, Candidate/Talent Intelligence,
// construireRecommandation) reste importée, jamais réimplémentée.
type CriteresMatchingClient = {
  competencesRecherchees: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
  anneesExperienceMin: number | null;
  localisation: string | null;
  disponibiliteSouhaitee: string | null;
};

// REV-02 (01/11/2026) : le VIVIER (profils exploitables, Skill Graph,
// missions et évaluations) est chargé une seule fois puis réutilisé pour
// autant de besoins que nécessaire — 3 requêtes au total, quel que soit le
// nombre de besoins actualisés ensemble.
export async function chargerVivier() {
  const { profils, profilIds, graphParProfil, graphIntelligenceParProfil } = await chargerProfilsEtSkillGraph();
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
  return { profils, graphParProfil, graphIntelligenceParProfil, missionsMap };
}
export type Vivier = Awaited<ReturnType<typeof chargerVivier>>;

// REV-02 : empreinte du vivier — change dès qu'un profil, une compétence,
// une preuve, une mission ou une évaluation est créé, modifié ou supprimé
// (nombre de lignes + date de dernière modification de chaque table lue par
// le matching). Une seule requête d'agrégats, sans lecture des lignes.
export async function calculerEmpreinteVivier(): Promise<string> {
  const lignes = await prisma.$queryRaw<{ e: string }[]>`
    SELECT concat_ws('|',
      (SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM "Profil"),
      (SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM "ProfilCompetence"),
      (SELECT count(*)::text || ':' || coalesce(max("createdAt")::text, '') FROM "SkillEvidence"),
      (SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM "Mission"),
      (SELECT count(*)::text || ':' || coalesce(max("createdAt")::text, '') FROM "Evaluation")
    ) AS e`;
  return createHash("sha256").update(lignes[0]?.e ?? "").digest("hex").slice(0, 32);
}

function recommanderDepuisVivier(vivier: Vivier, criteres: CriteresMatchingClient) {
  const { profils, graphParProfil, graphIntelligenceParProfil, missionsMap } = vivier;
  const profilsAvecSkillGraph: ProfilPourMatching[] = profils.map((p) => ({
    ...p,
    competencesGraph: graphParProfil.get(p.id) ?? [],
  }));

  const criteresMatching = {
    competencesRecherchees: criteres.competencesRecherchees,
    senioriteSouhaitee: criteres.senioriteSouhaitee,
    budgetTjmMax: criteres.budgetTjmMax,
    anneesExperienceMin: criteres.anneesExperienceMin ?? undefined,
    disponibiliteSouhaitee: criteres.disponibiliteSouhaitee ?? undefined,
    localisation: criteres.localisation ?? undefined,
  };
  const classement = classerProfils(profilsAvecSkillGraph, criteresMatching);

  // Seuls les profils ADMISSIBLES sont proposés au Client (aucune compétence
  // demandée couverte ou contrainte bloquante : jamais présentés) ; les
  // correspondances fortes d'abord. L'Admin garde la vue complète (voir
  // analyserCandidatsPourAdmin).
  const profilPourMatchingParId = new Map(profilsAvecSkillGraph.map((p) => [p.id, p]));
  const top = classement
    .map((resultat) => ({ resultat, admissibilite: evaluerAdmissibilite(profilPourMatchingParId.get(resultat.profilId)!, criteresMatching, resultat) }))
    .filter((x) => x.admissibilite.presentableClient)
    .sort(comparerAdmissibles)
    .slice(0, NOMBRE_OPTIONS_CLIENT_MAX);
  const profilsParId = new Map(profils.map((p) => [p.id, p]));

  return top.map(({ resultat: resultatMatching, admissibilite }) => {
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
    return { recommandation, disponibiliteBrute: profil.disponibilite, admissibilite };
  });
}

const MAX_TENTATIVES_SERIALISATION = 3;

// Point d'entrée principal — idempotent (même besoin + mêmes critères
// résolus = pas de nouvelle génération, voir signature.ts) et sûr en
// concurrence (transaction Serializable + nouvelle tentative sur conflit
// d'écriture Postgres — jamais de doublon même sur deux requêtes
// simultanées).
// ANO-02 (28/10/2026) : la transaction interactive n'exécute plus AUCUNE
// requête hors `tx`. Auparavant, le chargement des candidats (client global
// `prisma`) avait lieu DANS la transaction : avec `connection_limit=1`
// (correctif ANO-01, Transaction Pooler), l'unique connexion était tenue par
// la transaction et la lecture globale attendait son expiration (P2028,
// 500 systématique). Les candidats sont désormais chargés AVANT la
// transaction (lecture seule), pour la signature de critères observée à ce
// moment ; la transaction relit le besoin et, si ses critères ont changé
// entre-temps (signature différente), recommence la tentative au lieu
// d'écrire des options calculées sur des critères périmés.
export function signatureDe(ligne: { donnees: Prisma.JsonValue }): string | undefined {
  return (ligne.donnees as unknown as DonneesSolutionOption | null)?.signatureSource;
}

// Lignes de la vague la plus récente : suite contiguë (par date décroissante)
// de lignes portant la signature courante — une vague plus ancienne de même
// signature (critères revenus à un état antérieur) n'est jamais mélangée.
export function derniereVague<T extends { donnees: Prisma.JsonValue; createdAt: Date }>(lignesDecroissantes: T[], signature: string): T[] {
  const plusRecente = lignesDecroissantes[0];
  const vagueId = (plusRecente?.donnees as unknown as DonneesSolutionOption | null)?.vagueId;
  let vague: T[];
  if (vagueId) {
    vague = lignesDecroissantes.filter((l) => (l.donnees as unknown as DonneesSolutionOption | null)?.vagueId === vagueId);
  } else {
    // Lignes antérieures au LOT 2 (sans vagueId) : suite contiguë de même
    // signature, limitée aux lignes écrites dans les 10 s de la plus récente
    // (une génération s'écrit en une seule transaction).
    vague = [];
    for (const ligne of lignesDecroissantes) {
      if (signatureDe(ligne) !== signature) break;
      if (plusRecente.createdAt.getTime() - ligne.createdAt.getTime() > 10_000) break;
      vague.push(ligne);
    }
  }
  return vague.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function criteresPourMatching(criteres: ReturnType<typeof suggererCriteresDemande>): CriteresMatchingClient {
  return {
    competencesRecherchees: criteres.competencesExtraites.map((c) => c.valeur),
    senioriteSouhaitee: criteres.senioriteSouhaitee?.valeur ?? null,
    budgetTjmMax: criteres.budgetTjmMax?.valeur ?? null,
    anneesExperienceMin: criteres.anneesExperienceMin?.valeur ?? null,
    localisation: criteres.localisation?.valeur ?? null,
    disponibiliteSouhaitee: criteres.disponibiliteSouhaitee?.valeur ?? null,
  };
}

class CriteresModifiesPendantGeneration extends Error {}

export type EtatRecherche = "A_JOUR" | "A_ACTUALISER";

export type ResultatSolutions = ResultatGeneration & { etat: EtatRecherche };

type LigneSolution = Awaited<ReturnType<typeof prisma.solutionOption.findMany>>[number];

function vueDepuisLignes(lignes: LigneSolution[]) {
  const vues = [...lignes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(ligneVersVue);
  return { options: vues.filter((v) => v.niveau === "OPTION"), recommandation: vues.find((v) => v.niveau === "RECOMMANDATION") ?? null };
}

// Empreinte du RÉSULTAT d'une recherche (profils retenus, dans l'ordre, et
// contenu présenté au Client) : un recalcul qui aboutit au même résultat ne
// crée jamais de nouvelle vague.
function empreinteResultatDe(candidats: ReturnType<typeof recommanderDepuisVivier>, optionsOrdonnees: { indexSource: number }[]): string {
  const contenu = optionsOrdonnees.map((o) => {
    const c = candidats[o.indexSource];
    return { profilId: c.recommandation.profilId, option: adapterEnOptionClient(c.recommandation, c.disponibiliteBrute, c.admissibilite) };
  });
  return createHash("sha256").update(JSON.stringify(contenu)).digest("hex").slice(0, 32);
}

// Vague affichée la plus récente, ou — pour les besoins générés avant
// REV-02 (aucune ligne SolutionVague) — la dernière vague historique.
async function lireVagueCourante(
  db: Prisma.TransactionClient | typeof prisma,
  needId: string,
  signature: string
): Promise<{ vague: { signatureCriteres: string; empreinteVivier: string; empreinteResultat: string | null; optionIds: string[] } | null; lignes: LigneSolution[] }> {
  const vague = await db.solutionVague.findFirst({ where: { needId }, orderBy: { createdAt: "desc" } });
  if (vague) {
    const lignes = vague.optionIds.length > 0 ? await db.solutionOption.findMany({ where: { id: { in: vague.optionIds } } }) : [];
    return { vague, lignes };
  }
  const historiques = await db.solutionOption.findMany({ where: { needId, niveau: { in: ["OPTION", "RECOMMANDATION"] } }, orderBy: { createdAt: "desc" } });
  if (historiques.length > 0 && signatureDe(historiques[0]) === signature) {
    return { vague: null, lignes: derniereVague(historiques, signature) };
  }
  return { vague: null, lignes: [] };
}

// Point d'entrée principal (REV-02, 01/11/2026).
//
// - Une recherche À JOUR (mêmes critères, même vivier) est relue telle
//   quelle : quelques requêtes, aucun matching, aucune écriture.
// - Sinon, avec `calcul: false` (affichage d'une liste), rien n'est
//   recalculé : la dernière vague valable pour ces critères est renvoyée avec
//   l'état A_ACTUALISER, et l'interface demande l'actualisation besoin par
//   besoin.
// - Avec `calcul: true`, le matching est exécuté (vivier fourni ou chargé une
//   fois) puis écrit en transaction Serializable : nouvelle vague seulement si
//   le résultat diffère ; une recherche sans résultat est mémorisée aussi.
// Sûr en concurrence : contrainte d'unicité (besoin, critères, vivier) et
// nouvelle tentative sur conflit — jamais de doublon (ANO-02 conservé : aucune
// requête hors `tx` dans la transaction).
export async function obtenirSolutions(
  needId: string,
  clientId: string,
  options: { calcul: boolean; empreinteVivier?: string; vivier?: () => Promise<Vivier> } = { calcul: true }
): Promise<ResultatSolutions> {
  for (let tentative = 0; tentative < MAX_TENTATIVES_SERIALISATION; tentative++) {
    try {
      const need = await prisma.clientNeed.findFirst({ where: { id: needId, clientId }, include: { faits: true } });
      if (!need) throw new Error("BESOIN_INTROUVABLE");
      const eligibilite = evaluerEligibiliteBesoin(need);
      if (!eligibilite.eligible) {
        return { eligible: false, raison: eligibilite.raison!, options: [], recommandation: null, decisions: [], etat: "A_JOUR" };
      }
      const criteres = suggererCriteresDemande(need.faits);
      const signature = calculerSignatureSource(criteres);
      const empreinteVivier = options.empreinteVivier ?? (await calculerEmpreinteVivier());

      // Historique des décisions — indépendant de la génération courante,
      // jamais recalculé (voir decision.ts, append-only).
      const decisions = (await prisma.solutionOption.findMany({ where: { needId, niveau: "DECISION" }, orderBy: { createdAt: "desc" } })).map(ligneVersVue);

      const courante = await lireVagueCourante(prisma, needId, signature);
      const aJour = courante.vague !== null && courante.vague.signatureCriteres === signature && courante.vague.empreinteVivier === empreinteVivier;
      const lignesValables = courante.vague === null || courante.vague.signatureCriteres === signature ? courante.lignes : [];
      if (aJour || !options.calcul) {
        return { eligible: true, ...vueDepuisLignes(lignesValables), decisions, etat: aJour ? "A_JOUR" : "A_ACTUALISER" };
      }

      // Recalcul (hors transaction, lecture seule) puis écriture atomique.
      const vivier = options.vivier ? await options.vivier() : await chargerVivier();
      const candidats = recommanderDepuisVivier(vivier, criteresPourMatching(criteres));
      const optionsClientSafe = candidats.map((c) => adapterEnOptionClient(c.recommandation, c.disponibiliteBrute, c.admissibilite));
      const resultatComparaison = comparerOptions(optionsClientSafe);
      const empreinteResultat = empreinteResultatDe(candidats, resultatComparaison.optionsOrdonnees);

      return await prisma.$transaction(
        async (tx) => {
          const relu = await tx.clientNeed.findFirst({ where: { id: needId, clientId }, include: { faits: true } });
          if (!relu) throw new Error("BESOIN_INTROUVABLE");
          if (calculerSignatureSource(suggererCriteresDemande(relu.faits)) !== signature) throw new CriteresModifiesPendantGeneration();

          const actuelle = await lireVagueCourante(tx, needId, signature);
          if (actuelle.vague && actuelle.vague.signatureCriteres === signature && actuelle.vague.empreinteVivier === empreinteVivier) {
            // Une requête concurrente vient d'écrire cette recherche.
            return { eligible: true, ...vueDepuisLignes(actuelle.lignes), decisions, etat: "A_JOUR" } as const;
          }

          // Même critères, même résultat : la vague affichée est conservée
          // (aucune nouvelle option), seule la recherche est mémorisée.
          if (actuelle.vague && actuelle.vague.signatureCriteres === signature && actuelle.vague.empreinteResultat === empreinteResultat) {
            await tx.solutionVague.create({
              data: { needId, clientId, signatureCriteres: signature, empreinteVivier, empreinteResultat, optionIds: actuelle.vague.optionIds },
            });
            return { eligible: true, ...vueDepuisLignes(actuelle.lignes), decisions, etat: "A_JOUR" } as const;
          }

          if (resultatComparaison.optionsOrdonnees.length === 0) {
            // Aucun candidat exploitable — jamais une option inventée ; la
            // recherche sans résultat est MÉMORISÉE (REV-02) et ne sera
            // relancée que si les critères ou le vivier changent.
            await tx.solutionVague.create({ data: { needId, clientId, signatureCriteres: signature, empreinteVivier, empreinteResultat, optionIds: [] } });
            return { eligible: true, options: [], recommandation: null, decisions, etat: "A_JOUR" } as const;
          }

          const lignesCreees: { id: string; rang: number }[] = [];
          const vagueId = randomUUID();
          for (const option of resultatComparaison.optionsOrdonnees) {
            const donnees: DonneesSolutionOption = {
              signatureSource: signature,
              vagueId,
              niveauCorrespondance: option.niveauCorrespondance,
              competencesManquantes: option.competencesManquantes,
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
                titre: titreOption(option),
                justification: option.rationale.join(" "),
                donnees: donneesVersJson(donnees),
              },
            });
            lignesCreees.push({ id: ligne.id, rang: option.rang });
            // LOT 2 : correspondance option -> profil, RÉSERVÉE à l'Admin
            // (jamais lue par une route Client, jamais dans SolutionOption).
            await tx.solutionOptionProfilInterne.create({
              data: { solutionOptionId: ligne.id, profilId: candidats[option.indexSource].recommandation.profilId },
            });
          }

          let idRecommandation: string | null = null;
          if (resultatComparaison.recommandation) {
            const optionSource = lignesCreees.find((l) => l.rang === resultatComparaison.recommandation!.rangRecommande);
            const donnees: DonneesSolutionOption = {
              signatureSource: signature,
              vagueId,
              competencesCorrespondantes: resultatComparaison.recommandation.criteresDeterminants,
              niveauConfiance: resultatComparaison.recommandation.niveauConfiance,
              rationale: [],
              criteresAPreciser: resultatComparaison.recommandation.inconnuesImportantes,
              disponibilite: resultatComparaison.optionsOrdonnees[resultatComparaison.recommandation.rangRecommande - 1].disponibilite,
              criteresDeterminants: resultatComparaison.recommandation.criteresDeterminants,
              inconnuesImportantes: resultatComparaison.recommandation.inconnuesImportantes,
              rangsAlternativesEquivalentes: resultatComparaison.recommandation.rangsAlternativesEquivalentes,
            };
            const ligneRecommandation = await tx.solutionOption.create({
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
            idRecommandation = ligneRecommandation.id;
          }

          const optionIds = [...lignesCreees.map((l) => l.id), ...(idRecommandation ? [idRecommandation] : [])];
          await tx.solutionVague.create({ data: { needId, clientId, signatureCriteres: signature, empreinteVivier, empreinteResultat, optionIds } });
          const toutesLesLignes = await tx.solutionOption.findMany({ where: { id: { in: optionIds } } });
          return { eligible: true, ...vueDepuisLignes(toutesLesLignes), decisions, etat: "A_JOUR" } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (erreur) {
      const estConflit =
        erreur instanceof Prisma.PrismaClientKnownRequestError && (erreur.code === "P2034" || erreur.code === "P2002");
      const criteresModifies = erreur instanceof CriteresModifiesPendantGeneration;
      if ((estConflit || criteresModifies) && tentative < MAX_TENTATIVES_SERIALISATION - 1) {
        continue; // une requête concurrente a écrit entre-temps : relecture à la tentative suivante, jamais un doublon
      }
      throw erreur;
    }
  }
  throw new Error("ÉCHEC_GÉNÉRATION_CONCURRENCE");
}

// Compatibilité : la route « Solutions possibles » d'un besoin calcule si
// nécessaire (un seul besoin à la fois).
export async function genererOuRecupererSolutions(needId: string, clientId: string): Promise<ResultatSolutions> {
  return obtenirSolutions(needId, clientId, { calcul: true });
}

// Lecture seule — utilisée par la route Admin (GET .../talent/besoins/[id]/
// solutions), qui n'a pas vocation à déclencher une génération (réservé au
// parcours Client, seul déclencheur légitime).
export async function listerSolutionsExistantes(needId: string): Promise<SolutionOptionVue[]> {
  const lignes = await prisma.solutionOption.findMany({ where: { needId }, orderBy: { createdAt: "asc" } });
  return lignes.map(ligneVersVue);
}

// VUE ADMIN (lecture seule, aucune écriture) : tous les profils au dossier
// exploitable, avec leur admissibilité pour ce besoin — présentables,
// opportunités (action requise avant présentation) et non pertinents —, les
// écarts et les actions possibles. Réservée à l'Admin (route
// GET /api/talent/besoins/[id]/solutions) : contient identité, score et
// valeurs internes, jamais transmis au Client.
export type AnalyseCandidatAdmin = {
  profilId: string;
  nom: string;
  prenom: string | null;
  scoreClassement: number;
  admissibilite: Admissibilite;
};

export async function analyserCandidatsPourAdmin(needId: string): Promise<AnalyseCandidatAdmin[] | null> {
  const need = await prisma.clientNeed.findUnique({ where: { id: needId }, include: { faits: true } });
  if (!need) return null;
  const criteres = suggererCriteresDemande(need.faits);
  const criteresMatching = {
    competencesRecherchees: criteres.competencesExtraites.map((c) => c.valeur),
    senioriteSouhaitee: criteres.senioriteSouhaitee?.valeur ?? null,
    budgetTjmMax: criteres.budgetTjmMax?.valeur ?? null,
    anneesExperienceMin: criteres.anneesExperienceMin?.valeur ?? undefined,
    disponibiliteSouhaitee: criteres.disponibiliteSouhaitee?.valeur ?? undefined,
    localisation: criteres.localisation?.valeur ?? undefined,
  };
  const { profils, graphParProfil } = await chargerProfilsEtSkillGraph();
  const pourMatching: ProfilPourMatching[] = profils.map((p) => ({ ...p, competencesGraph: graphParProfil.get(p.id) ?? [] }));
  const parId = new Map(pourMatching.map((p) => [p.id, p]));
  const identites = new Map(profils.map((p) => [p.id, p]));
  return classerProfils(pourMatching, criteresMatching)
    .map((resultat) => ({ resultat, admissibilite: evaluerAdmissibilite(parId.get(resultat.profilId)!, criteresMatching, resultat) }))
    .sort(comparerAdmissibles)
    .map(({ resultat, admissibilite }) => ({
      profilId: resultat.profilId,
      nom: identites.get(resultat.profilId)!.nom,
      prenom: identites.get(resultat.profilId)!.prenom,
      scoreClassement: resultat.score,
      admissibilite,
    }));
}
