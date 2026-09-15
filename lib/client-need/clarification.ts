// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification (15/09/2026).
//
// Fonction PURE (aucun accès Prisma, aucun appel IA) : transforme le
// diagnostic déjà produit par evaluerCoherenceBesoin() (LOT 2) et les
// faits importants manquants (CLES_IMPORTANTES_SI_ABSENTES, LOT 2) en une
// liste de clarifications ACTIONNABLES et PRIORISÉES. N'invente rien : ne
// fait que relier chaque explication déjà rédigée par le moteur de
// cohérence à la ou les clés qu'il faudrait corriger pour la résoudre.
//
// Priorité : CONTRADICTION (INCONSISTENT) > A_PRECISER (NEEDS_CLARIFICATION)
// > MANQUANT (fait important absent). Dédoublonné par clé, plafonné à un
// petit nombre de questions visibles (jamais 20 questions).
//
// Périmètre LOT 3 (décision CEO) : uniquement les clés NON RÉPÉTABLES —
// les clés répétables (COMPETENCE, CONTRAINTE, CRITERE_REUSSITE, PRIORITE,
// RISQUE, PREFERENCE) restent hors périmètre.

import type { ClientNeedFaitCle } from "@prisma/client";
import type { ReglePlateforme } from "./coherence";
import { CLES_IMPORTANTES_SI_ABSENTES } from "./extraction";

// Type d'entrée volontairement plus large que ResultatRegle (lib/client-need/
// coherence.ts) : côté serveur comme côté client, `coherenceDetail` peut
// provenir d'une relecture JSON (API ou Prisma Json?) où `regle` n'est
// connu que comme une chaîne — jamais une raison de dupliquer le type.
export type ResultatReglePourClarification = { regle: string; statut: string; explication: string };

export const CLES_CLARIFIABLES: ClientNeedFaitCle[] = [
  "ROLE",
  "SENIORITE",
  "ANNEES_EXPERIENCE_MIN",
  "BUDGET_MONTANT",
  "BUDGET_DEVISE",
  "BUDGET_TYPE",
  "BUDGET_FREQUENCE",
  "DUREE",
  "DATE_DEBUT",
  "DISPONIBILITE",
  "LOCALISATION",
  "REMOTE",
];

// Pour chaque règle du moteur de cohérence : quelle(s) clé(s), si
// corrigée(s), permettraient de résoudre le diagnostic qu'elle a soulevé.
// Table statique, aucune nouvelle logique de décision — un simple lien
// entre un diagnostic déjà déterministe et les clés déjà modélisées.
const CLES_ACTIONNABLES_PAR_REGLE: Record<ReglePlateforme, ClientNeedFaitCle[]> = {
  SENIORITE_EXPERIENCE: ["SENIORITE", "ANNEES_EXPERIENCE_MIN"],
  BUDGET_TYPE_MONTANT: ["BUDGET_MONTANT"],
  BUDGET_ABONNEMENT_FREQUENCE: ["BUDGET_FREQUENCE"],
  REMOTE_LOCALISATION: ["LOCALISATION"],
  DUREE_DISPONIBILITE: ["DISPONIBILITE"],
};

function clesActionnables(regle: string): ClientNeedFaitCle[] {
  return CLES_ACTIONNABLES_PAR_REGLE[regle as ReglePlateforme] ?? [];
}

export type PrioriteClarification = "CONTRADICTION" | "A_PRECISER" | "MANQUANT";

export type Clarification = {
  cle: ClientNeedFaitCle;
  priorite: PrioriteClarification;
  explication: string | null;
  valeurActuelle: string | null;
};

const MAX_CLARIFICATIONS_VISIBLES = 5;

export function prioriserClarifications(
  faitsActuels: Map<string, { valeur: string; statut: string }>,
  coherenceDetail: ResultatReglePourClarification[]
): Clarification[] {
  const resultat: Clarification[] = [];
  const dejaAjoutees = new Set<ClientNeedFaitCle>();

  function ajouter(cle: ClientNeedFaitCle, priorite: PrioriteClarification, explication: string | null) {
    if (dejaAjoutees.has(cle)) return;
    dejaAjoutees.add(cle);
    const actuel = faitsActuels.get(cle);
    resultat.push({
      cle,
      priorite,
      explication,
      valeurActuelle: actuel && actuel.valeur ? actuel.valeur : null,
    });
  }

  for (const regle of coherenceDetail) {
    if (regle.statut !== "INCONSISTENT") continue;
    for (const cle of clesActionnables(regle.regle)) {
      ajouter(cle, "CONTRADICTION", regle.explication);
    }
  }

  for (const regle of coherenceDetail) {
    if (regle.statut !== "NEEDS_CLARIFICATION") continue;
    for (const cle of clesActionnables(regle.regle)) {
      ajouter(cle, "A_PRECISER", regle.explication);
    }
  }

  for (const cle of CLES_IMPORTANTES_SI_ABSENTES) {
    const actuel = faitsActuels.get(cle);
    if (!actuel || actuel.statut === "INCONNU" || !actuel.valeur) {
      ajouter(cle as ClientNeedFaitCle, "MANQUANT", null);
    }
  }

  return resultat.slice(0, MAX_CLARIFICATIONS_VISIBLES);
}
