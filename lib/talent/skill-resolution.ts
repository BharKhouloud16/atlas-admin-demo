// ATLAS TALENT — Skill Resolution V1 (Lot 11, 29/09/2026).
//
// Remplace la simple recherche de sous-chaîne (String.includes) utilisée
// jusqu'ici pour détecter une compétence dans un texte libre (CV, description
// de demande) par une correspondance par MOT ENTIER (frontières de mot) —
// pour éliminer le faux positif déjà documenté (Lot 10) : "PostgreSQL"
// contient littéralement la sous-chaîne "sql" et déclenchait donc, à tort,
// une détection indépendante de la compétence générique "SQL".
//
// Ajoute par ailleurs une table d'ALIAS explicite et volontairement courte :
// une variante d'ÉCRITURE d'une compétence DÉJÀ présente dans le catalogue
// fermé (lib/competences.ts, TOUTES_COMPETENCES) — jamais une compétence
// nouvelle, jamais une relation entre deux compétences distinctes. Docker
// n'implique jamais Kubernetes, Python n'implique jamais Django : ce module
// ne déduit rien, il reconnaît seulement qu'une même compétence peut
// s'écrire de plusieurs façons usuelles (ex. "K8s" pour "Kubernetes").
//
// RÈGLE ABSOLUE (héritée de lib/talent/skill-graph.ts) : une résolution
// reste TOUJOURS une inférence en aval (statut INFERE, jamais VERIFIE) —
// même une correspondance EXACTE au mot près n'est jamais une preuve
// vérifiée. `methode` documente uniquement la qualité de la détection
// elle-même (mention littérale du nom canonique vs variante d'écriture
// connue), jamais une vérité métier.

export type MethodeResolution = "EXACT" | "ALIAS";

export type CompetenceResolue = {
  competence: string; // nom canonique, tel qu'il existe dans TOUTES_COMPETENCES
  methode: MethodeResolution;
  aliasTrouve: string | null; // la forme brute reconnue dans le texte, uniquement si methode === "ALIAS"
};

function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function echapperRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Frontière de mot "intelligente" : n'exige une frontière \b (au sens
// JS, basée sur \w = lettres/chiffres/_) que du côté où le segment
// commence/finit réellement par un caractère \w. Un segment qui commence
// ou finit par un symbole (ex. "c#", ".net") porte déjà sa propre limite
// naturelle à cet endroit — lui imposer en plus un \b y échouerait à tort
// (JS ne considère jamais une transition symbole -> symbole comme une
// frontière). Cette fonction reste un détail d'implémentation interne,
// jamais exposée : elle ne change rien à la sémantique "mot entier" pour
// les compétences alphanumériques (l'immense majorité du catalogue), et
// évite une régression silencieuse sur les quelques entrées qui ne le sont
// pas (ex. "C# / .NET").
function construireMotif(segment: string): RegExp {
  const prefixe = /^[a-z0-9]/i.test(segment) ? "\\b" : "";
  const suffixe = /[a-z0-9]$/i.test(segment) ? "\\b" : "";
  return new RegExp(`${prefixe}${echapperRegex(segment)}${suffixe}`);
}

function contientMot(normalise: string, segment: string): boolean {
  return construireMotif(segment).test(normalise);
}

// ALIAS — variantes d'écriture usuelles d'une compétence DÉJÀ présente dans
// TOUTES_COMPETENCES. Liste volontairement courte et explicite (Lot 11,
// §5/§7 du mandat) : chaque entrée doit pouvoir se justifier comme "même
// compétence, autre façon de l'écrire", jamais comme "compétence
// probablement liée". `cible` est le segment normalisé (minuscule, sans
// accent) de l'entrée canonique visée dans TOUTES_COMPETENCES.
const ALIAS: { alias: string; cible: string }[] = [
  { alias: "k8s", cible: "kubernetes" },
  { alias: "js", cible: "javascript" },
  { alias: "ts", cible: "typescript" },
  { alias: "react.js", cible: "react" },
  { alias: "reactjs", cible: "react" },
  // LOT 11.1 — DÉCISION 2 : "Postgres" est une variante d'écriture de
  // "PostgreSQL" (compétence canonique désormais distincte de "SQL", voir
  // lib/competences.ts) — jamais un alias de "SQL" lui-même : PostgreSQL
  // et MySQL restent tous deux sans aucune relation implicite vers "SQL".
  { alias: "postgres", cible: "postgresql" },
];

// Résout, pour chaque compétence du catalogue fourni, si elle est
// détectable dans le texte — par mention littérale du nom canonique
// (EXACT) ou par une variante d'écriture explicitement listée (ALIAS).
// Ne retourne jamais une compétence hors catalogue : `catalogue` reste la
// seule source de vérité des noms possibles (TOUTES_COMPETENCES en
// pratique), jamais étendue ni devinée ici.
export function resoudreCompetencesDepuisTexte(texte: string, catalogue: string[]): CompetenceResolue[] {
  const normalise = normaliser(texte);
  const resultats: CompetenceResolue[] = [];

  for (const competence of catalogue) {
    const segments = normaliser(competence)
      .split(" / ")
      .map((s) => s.trim())
      .filter(Boolean);

    const segmentExact = segments.find((segment) => contientMot(normalise, segment));
    if (segmentExact) {
      resultats.push({ competence, methode: "EXACT", aliasTrouve: null });
      continue;
    }

    const aliasCorrespondant = ALIAS.find((a) => segments.includes(a.cible) && contientMot(normalise, a.alias));
    if (aliasCorrespondant) {
      resultats.push({ competence, methode: "ALIAS", aliasTrouve: aliasCorrespondant.alias });
    }
  }

  return resultats;
}
