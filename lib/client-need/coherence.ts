// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Moteur de cohérence — fonction PURE, aucun accès Prisma (même discipline
// que lib/control-plane/domain.ts et calculerHumanNecessity/
// calculerPlafondAutonomie, B22/B23) : prend les faits déjà relus par
// l'appelant, ne va jamais les chercher elle-même. Entièrement testable
// sans base de données.
//
// RÈGLE ABSOLUE (directive de la mission) : ce moteur ne décide jamais à la
// place du client — il produit un diagnostic explicable (COHERENT /
// INCONSISTENT / NEEDS_CLARIFICATION / UNKNOWN), jamais un blocage. Il ne
// lit JAMAIS HYPOTHESE_DOMAINE_SOLUTION (revue architecturale, point 1) :
// le routage exploratoire reste strictement hors de la cohérence du besoin.

export type FaitPourCoherence = { cle: string; valeur: string };

export type ReglePlateforme =
  | "SENIORITE_EXPERIENCE"
  | "BUDGET_TYPE_MONTANT"
  | "BUDGET_ABONNEMENT_FREQUENCE"
  | "REMOTE_LOCALISATION"
  | "DUREE_DISPONIBILITE";

export type ResultatRegle = {
  regle: ReglePlateforme;
  statut: "COHERENT" | "INCONSISTENT" | "NEEDS_CLARIFICATION";
  explication: string;
};

export type CoherenceBesoin = {
  statut: "COHERENT" | "INCONSISTENT" | "NEEDS_CLARIFICATION" | "UNKNOWN";
  detail: ResultatRegle[];
};

// Rangs de séniorité déclarée — utilisés uniquement pour comparer à une
// fourchette d'années plausible, jamais pour recalculer une séniorité à
// partir des années (la séniorité déclarée reste la donnée déclarée).
const FOURCHETTE_ANNEES_PAR_SENIORITE: Record<string, { min: number; max: number }> = {
  Junior: { min: 0, max: 2 },
  Confirmé: { min: 2, max: 5 },
  Senior: { min: 5, max: 10 },
  Expert: { min: 8, max: 99 },
};

function valeur(faits: FaitPourCoherence[], cle: string): string | undefined {
  return faits.find((f) => f.cle === cle)?.valeur;
}

function regleSenioriteExperience(faits: FaitPourCoherence[]): ResultatRegle | null {
  const seniorite = valeur(faits, "SENIORITE");
  const anneesTexte = valeur(faits, "ANNEES_EXPERIENCE_MIN");
  if (!seniorite || !anneesTexte) return null;
  const annees = Number(anneesTexte);
  if (!Number.isFinite(annees)) return null;

  const fourchette = FOURCHETTE_ANNEES_PAR_SENIORITE[seniorite];
  if (!fourchette) return null;

  if (annees < fourchette.min || annees > fourchette.max) {
    return {
      regle: "SENIORITE_EXPERIENCE",
      statut: "INCONSISTENT",
      explication: `Séniorité déclarée "${seniorite}" mais ${annees} an(s) d'expérience déclaré(s) — ces deux informations ne sont habituellement pas compatibles. Laquelle souhaitez-vous conserver ?`,
    };
  }
  return {
    regle: "SENIORITE_EXPERIENCE",
    statut: "COHERENT",
    explication: `Séniorité "${seniorite}" cohérente avec ${annees} an(s) d'expérience déclaré(s).`,
  };
}

function regleBudgetTypeMontant(faits: FaitPourCoherence[]): ResultatRegle | null {
  const type = valeur(faits, "BUDGET_TYPE");
  const montant = valeur(faits, "BUDGET_MONTANT");
  if (!type) return null;
  if (!montant) {
    return {
      regle: "BUDGET_TYPE_MONTANT",
      statut: "NEEDS_CLARIFICATION",
      explication: `Un type de budget ("${type}") est indiqué mais aucun montant n'a été précisé.`,
    };
  }
  return { regle: "BUDGET_TYPE_MONTANT", statut: "COHERENT", explication: `Budget "${type}" de ${montant} précisé.` };
}

function regleBudgetAbonnementFrequence(faits: FaitPourCoherence[]): ResultatRegle | null {
  const type = valeur(faits, "BUDGET_TYPE");
  if (type !== "ABONNEMENT") return null;
  const frequence = valeur(faits, "BUDGET_FREQUENCE");
  if (!frequence) {
    return {
      regle: "BUDGET_ABONNEMENT_FREQUENCE",
      statut: "NEEDS_CLARIFICATION",
      explication: `Budget de type abonnement, mais la fréquence (mensuelle, annuelle...) n'est pas précisée.`,
    };
  }
  return { regle: "BUDGET_ABONNEMENT_FREQUENCE", statut: "COHERENT", explication: `Fréquence d'abonnement précisée (${frequence}).` };
}

function regleRemoteLocalisation(faits: FaitPourCoherence[]): ResultatRegle | null {
  const remote = valeur(faits, "REMOTE");
  if (remote !== "Sur site") return null;
  const localisation = valeur(faits, "LOCALISATION");
  if (!localisation) {
    return {
      regle: "REMOTE_LOCALISATION",
      statut: "NEEDS_CLARIFICATION",
      explication: `Une présence "sur site" est demandée, mais aucune localisation n'est précisée.`,
    };
  }
  return { regle: "REMOTE_LOCALISATION", statut: "COHERENT", explication: `Présence sur site à "${localisation}" précisée.` };
}

function regleDureeDisponibilite(faits: FaitPourCoherence[]): ResultatRegle | null {
  const duree = valeur(faits, "DUREE");
  if (!duree) return null;
  const disponibilite = valeur(faits, "DISPONIBILITE");
  const dateDebut = valeur(faits, "DATE_DEBUT");
  if (!disponibilite && !dateDebut) {
    return {
      regle: "DUREE_DISPONIBILITE",
      statut: "NEEDS_CLARIFICATION",
      explication: `Une durée (${duree}) est précisée, mais aucune date de début ni disponibilité souhaitée.`,
    };
  }
  return { regle: "DUREE_DISPONIBILITE", statut: "COHERENT", explication: `Durée (${duree}) accompagnée d'une disponibilité/date de début.` };
}

export function evaluerCoherenceBesoin(faits: FaitPourCoherence[]): CoherenceBesoin {
  const resultats = [
    regleSenioriteExperience(faits),
    regleBudgetTypeMontant(faits),
    regleBudgetAbonnementFrequence(faits),
    regleRemoteLocalisation(faits),
    regleDureeDisponibilite(faits),
  ].filter((r): r is ResultatRegle => r !== null);

  if (resultats.length === 0) {
    return { statut: "UNKNOWN", detail: [] };
  }
  if (resultats.some((r) => r.statut === "INCONSISTENT")) {
    return { statut: "INCONSISTENT", detail: resultats };
  }
  if (resultats.some((r) => r.statut === "NEEDS_CLARIFICATION")) {
    return { statut: "NEEDS_CLARIFICATION", detail: resultats };
  }
  return { statut: "COHERENT", detail: resultats };
}
