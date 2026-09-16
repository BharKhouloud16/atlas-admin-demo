import type { OptionClientSafe, OptionOrdonnee, RecommandationSolution, ResultatComparaison } from "./types";

// COMPANY ATLAS — V2.1-B : C3 Solution Intelligence — comparerOptions().
//
// Fonction pure, déterministe, sans DB/HTTP/Date.now()/Math.random(), sans
// état global mutable — ne compare que des OptionClientSafe déjà passées par
// adapterEnOptionClient() (adapter.ts). Comparaison multicritère explicable
// par ordre lexicographique, jamais un score pondéré arbitraire (70/20/10 ou
// équivalent) : nombre de compétences correspondantes, puis niveau de
// confiance qualitatif, puis nombre de critères encore à préciser — chaque
// critère est lui-même explicable individuellement dans le résultat.

const ORDRE_CONFIANCE: Record<OptionClientSafe["niveauConfiance"], number> = {
  HAUTE: 3,
  MOYENNE: 2,
  BASSE: 1,
  INCONNUE: 0,
};

// Compare deux options sur le seul contenu métier (jamais leur position
// d'origine) — utilisée à la fois pour trier et pour détecter une
// équivalence réelle entre deux options.
function comparerSubstance(a: OptionClientSafe, b: OptionClientSafe): number {
  const diffCompetences = b.competencesCorrespondantes.length - a.competencesCorrespondantes.length;
  if (diffCompetences !== 0) return diffCompetences;
  const diffConfiance = ORDRE_CONFIANCE[b.niveauConfiance] - ORDRE_CONFIANCE[a.niveauConfiance];
  if (diffConfiance !== 0) return diffConfiance;
  return a.criteresAPreciser.length - b.criteresAPreciser.length;
}

// Justification factuelle de l'option elle-même — ne compare JAMAIS
// nommément à une autre option (jamais "meilleure que", jamais de fuite
// indirecte du type "l'option la moins chère" ou "la plus expérimentée").
function construireJustification(option: OptionOrdonnee): string {
  const parties: string[] = [];
  if (option.competencesCorrespondantes.length > 0) {
    parties.push(`Compétences recherchées retrouvées : ${option.competencesCorrespondantes.join(", ")}.`);
  }
  parties.push(`Niveau de confiance : ${option.niveauConfiance}.`);
  parties.push(
    option.disponibilite.statut === "CONNUE" && option.disponibilite.detail
      ? `${option.disponibilite.detail}.`
      : "Disponibilité à confirmer."
  );
  if (option.criteresAPreciser.length > 0) {
    parties.push(`À préciser : ${option.criteresAPreciser.join(", ")}.`);
  }
  return parties.join(" ");
}

export function comparerOptions(options: OptionClientSafe[]): ResultatComparaison {
  if (options.length === 0) {
    return { optionsOrdonnees: [], recommandation: null, raisonAbsenceRecommandation: "AUCUNE_OPTION" };
  }

  // Index d'origine conservé uniquement comme départage final déterministe
  // (jamais utilisé pour décider d'une équivalence métier) — garantit un
  // résultat stable et reproductible pour une même entrée, sans dépendre de
  // la stabilité du tri du moteur JS.
  const triees = options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const diffSubstance = comparerSubstance(a.option, b.option);
      if (diffSubstance !== 0) return diffSubstance;
      return a.index - b.index;
    });

  const optionsOrdonnees: OptionOrdonnee[] = triees.map(({ option }, position) => ({ ...option, rang: position + 1 }));

  const meilleure = optionsOrdonnees[0];
  // "Critères critiques suffisamment établis" (voir revue architecturale
  // V2.1-B, cas 1 option) : au moins un signal réel (confiance connue ou au
  // moins une compétence retrouvée) — sinon pas de recommandation forcée,
  // même s'il n'existe qu'une seule option.
  const donneesSuffisantes = meilleure.niveauConfiance !== "INCONNUE" || meilleure.competencesCorrespondantes.length > 0;
  if (!donneesSuffisantes) {
    return { optionsOrdonnees, recommandation: null, raisonAbsenceRecommandation: "DONNEES_INSUFFISANTES" };
  }

  // Options à égalité stricte de substance avec la meilleure — jamais un
  // gagnant inventé entre deux options réellement équivalentes.
  const rangsAlternativesEquivalentes = optionsOrdonnees.slice(1).filter((candidate) => comparerSubstance(candidate, meilleure) === 0).map((c) => c.rang);

  const recommandation: RecommandationSolution = {
    rangRecommande: meilleure.rang,
    justification: construireJustification(meilleure),
    criteresDeterminants: [...meilleure.competencesCorrespondantes],
    inconnuesImportantes: [...meilleure.criteresAPreciser],
    rangsAlternativesEquivalentes,
    niveauConfiance: meilleure.niveauConfiance,
  };

  return { optionsOrdonnees, recommandation, raisonAbsenceRecommandation: null };
}
