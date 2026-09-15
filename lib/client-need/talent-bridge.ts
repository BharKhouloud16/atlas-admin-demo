// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Fonctions PURES (aucun accès Prisma, aucune IA) : transforment les
// ClientNeedFait déjà extraits/validés (LOT 2/3) en une SUGGESTION de
// critères DemandeTalent, jamais en une création automatique. Chaque champ
// suggéré reste porteur de la provenance (StatutPreuveCompetence) de son
// ClientNeedFait d'origine — jamais recalculée, jamais upgradée
// silencieusement (INFERE ne devient jamais VERIFIE ici). L'ADMIN reste
// seul décideur : voir app/api/talent/besoins/[id]/creer-demande/route.ts,
// qui n'écrit jamais directement ces suggestions sans relecture/édition
// explicite côté appelant.
//
// Règle absolue : ne jamais inventer une valeur. Un champ numérique/date
// dont le texte source n'est pas strictement parsable reste `null` — à
// saisir manuellement par l'Admin, jamais deviné.

export type FaitPourSuggestion = { cle: string; valeur: string; statut: string };

export type ChampSuggere<T> = { valeur: T; statut: string } | null;

export type SuggestionCriteresDemande = {
  titreSuggere: ChampSuggere<string>;
  competencesExtraites: { valeur: string; statut: string }[];
  senioriteSouhaitee: ChampSuggere<string>;
  anneesExperienceMin: ChampSuggere<number>;
  localisation: ChampSuggere<string>;
  disponibiliteSouhaitee: ChampSuggere<string>;
  budgetTjmMax: ChampSuggere<number>;
  budgetDevise: ChampSuggere<string>;
  dateDebutSouhaitee: ChampSuggere<string>;
  // Non mappé automatiquement sur `mobilite` (DemandeTalent) : les valeurs
  // possibles de ce champ ("Remote"/"Hybride"/"Sur site", voir
  // lib/validation.ts) ne correspondent à aucun vocabulaire fermé côté
  // ClientNeedFait.REMOTE (texte libre) — mapper à l'aveugle inventerait une
  // correspondance. Affiché en lecture seule pour que l'Admin choisisse.
  remoteDeclare: ChampSuggere<string>;
};

function dernierFait(faits: FaitPourSuggestion[], cle: string): FaitPourSuggestion | undefined {
  const correspondants = faits.filter((f) => f.cle === cle);
  return correspondants.length > 0 ? correspondants[correspondants.length - 1] : undefined;
}

function parserEntierStrict(valeur: string): number | null {
  const nettoye = valeur.trim();
  return /^\d{1,3}$/.test(nettoye) ? Number.parseInt(nettoye, 10) : null;
}

function parserMontantStrict(valeur: string): number | null {
  const nettoye = valeur.trim().replace(",", ".");
  return /^\d{1,6}(\.\d{1,2})?$/.test(nettoye) ? Number.parseFloat(nettoye) : null;
}

function parserDeviseStricte(valeur: string): string | null {
  const nettoye = valeur.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(nettoye) ? nettoye : null;
}

function parserDateStricte(valeur: string): string | null {
  const nettoye = valeur.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(nettoye) ? nettoye : null;
}

// Fonction pure : ne lit que les faits fournis, ne calcule aucune moyenne,
// ne fusionne jamais deux valeurs contradictoires — la dernière occurrence
// d'une clé singleton l'emporte (même discipline que dernierFaitParCle,
// lib/client-need/faits.ts), les clés répétables (COMPETENCE) sont toutes
// conservées.
export function suggererCriteresDemande(faits: FaitPourSuggestion[]): SuggestionCriteresDemande {
  const role = dernierFait(faits, "ROLE");
  const seniorite = dernierFait(faits, "SENIORITE");
  const anneesExperience = dernierFait(faits, "ANNEES_EXPERIENCE_MIN");
  const localisation = dernierFait(faits, "LOCALISATION");
  const disponibilite = dernierFait(faits, "DISPONIBILITE");
  const budgetMontant = dernierFait(faits, "BUDGET_MONTANT");
  const budgetDevise = dernierFait(faits, "BUDGET_DEVISE");
  const dateDebut = dernierFait(faits, "DATE_DEBUT");
  const remote = dernierFait(faits, "REMOTE");

  const anneesParsees = anneesExperience ? parserEntierStrict(anneesExperience.valeur) : null;
  const budgetParse = budgetMontant ? parserMontantStrict(budgetMontant.valeur) : null;
  const deviseParsee = budgetDevise ? parserDeviseStricte(budgetDevise.valeur) : null;
  const dateParsee = dateDebut ? parserDateStricte(dateDebut.valeur) : null;

  return {
    titreSuggere: role ? { valeur: role.valeur, statut: role.statut } : null,
    competencesExtraites: faits.filter((f) => f.cle === "COMPETENCE").map((f) => ({ valeur: f.valeur, statut: f.statut })),
    senioriteSouhaitee: seniorite ? { valeur: seniorite.valeur, statut: seniorite.statut } : null,
    anneesExperienceMin: anneesExperience && anneesParsees !== null ? { valeur: anneesParsees, statut: anneesExperience.statut } : null,
    localisation: localisation ? { valeur: localisation.valeur, statut: localisation.statut } : null,
    disponibiliteSouhaitee: disponibilite ? { valeur: disponibilite.valeur, statut: disponibilite.statut } : null,
    budgetTjmMax: budgetMontant && budgetParse !== null ? { valeur: budgetParse, statut: budgetMontant.statut } : null,
    budgetDevise: budgetDevise && deviseParsee !== null ? { valeur: deviseParsee, statut: budgetDevise.statut } : null,
    dateDebutSouhaitee: dateDebut && dateParsee !== null ? { valeur: dateParsee, statut: dateDebut.statut } : null,
    remoteDeclare: remote ? { valeur: remote.valeur, statut: remote.statut } : null,
  };
}

export type EligibiliteBesoin = { eligible: boolean; raison: string | null };

// LOT 3 a déjà construit un vrai mécanisme de validation (clarification +
// cohérence) qui aboutit au statut VALIDE — réutilisé tel quel comme unique
// critère de "suffisamment d'informations", plutôt que d'inventer une
// seconde heuristique parallèle (directive LOT 5, Phase 1B).
export function evaluerEligibiliteBesoin(need: { statut: string }): EligibiliteBesoin {
  if (need.statut === "VALIDE") return { eligible: true, raison: null };
  return {
    eligible: false,
    raison: `Informations insuffisantes pour créer une demande — le besoin doit d'abord être validé (statut actuel : ${need.statut}).`,
  };
}
