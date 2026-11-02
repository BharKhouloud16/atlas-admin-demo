// LOT 1 (28/10/2026) — heuristiques d'extraction du provider local
// (lib/ai/provider.ts), isolées ici pour être testées une à une.
//
// Corrige trois défauts relevés en recette (registre ANO-03, ANO-06) :
//   - une compétence était reconnue par simple sous-chaîne : « rag » (de
//     « Prompt engineering / RAG ») était trouvé dans « démarrage » ;
//   - le budget était le PREMIER nombre de 2 à 5 chiffres du texte : dans
//     « à partir de janvier 2027 … budget 550 EUR par jour », l'année 2027 ;
//   - la durée n'était reconnue qu'après « pendant » / « durant », jamais
//     « pour 6 mois » ni « mission de 4 mois ».
//
// Même discipline que le provider : fonctions pures, déterministes, aucune
// valeur inventée — en cas de doute, rien n'est extrait (le fait reste
// « à préciser » et le client le complète).

export function normaliserTexte(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Vrai si `terme` apparaît comme mot (ou groupe de mots) entier : jamais à
// l'intérieur d'un autre mot. Les caractères non alphanumériques du terme
// lui-même (« c# », « node.js », « ci/cd ») sont conservés tels quels.
// `accordable` : accepte aussi les formes accordées en genre/nombre du
// DERNIER mot (« développeurs », « confirmées ») — pour les rôles et les
// séniorités, jamais pour les compétences (noms propres de technologies).
export function contientTerme(texteNormalise: string, terme: string, accordable = false): boolean {
  const t = normaliserTexte(terme).trim();
  if (!t) return false;
  const suffixe = accordable ? "(?:e?s?)" : "";
  const motif = new RegExp(`(^|[^a-z0-9])${echapper(t)}${suffixe}(?=$|[^a-z0-9])`);
  return motif.test(texteNormalise);
}

// Une compétence composite (« TestNG / JUnit », « Prompt engineering / RAG »)
// est reconnue si l'un de ses segments apparaît comme terme entier.
// REV P3 (01/11/2026) — vérification de l'impact sur l'analyse des CV
// (Skill Graph) : la reconnaissance par mot entier supprime les faux positifs
// (« Java » dans « JavaScript », « REST » dans « restauration », « IA » dans
// « stagiaire », « SOAP » dans « SoapUI »), mais deux formulations courantes
// des CV ne doivent pas être perdues :
//   - un numéro de version accolé (« Python3 », « PHP8 », « Java17 ») ;
//   - les dialectes SQL nommés (« MySQL », « PostgreSQL », « PL/SQL »…).
//
// Revue SOAP (01/11/2026) — analyse systématique des graphies de CV dont la
// détection a changé avec la reconnaissance par mot entier. Règle retenue :
// une variante est ajoutée seulement si l'ANCIENNE détection la reconnaissait
// et si elle désigne sans ambiguïté la compétence (aucune détection nouvelle
// inventée). Restaurées : « ReactJS », « RESTful », « ASP.NET » / « VB.NET »,
// « JavaEE », « PHPUnit » (framework propre à PHP), « Dockerfile » /
// « dockerisé(e)s », « Jenkinsfile ».
// SOAP / SoapUI : le référentiel contient DEUX compétences distinctes, l'outil
// « SoapUI » et le protocole « SOAP ». « SoapUI » donne SoapUI, jamais SOAP
// (l'ancienne détection de SOAP dans « SoapUI » était un effet de sous-chaîne,
// et SoapUI sert aussi aux API REST). Les graphies « SOAP UI » / « Soap-UI »
// désignent l'outil : SoapUI, et non le protocole.
const VARIANTES_COMPETENCE: Record<string, string[]> = {
  sql: ["mysql", "postgresql", "pl/sql", "plsql", "t-sql", "tsql", "sqlite", "sql server"],
  react: ["reactjs"],
  rest: ["restful"],
  ".net": ["asp.net", "vb.net", "ado.net"],
  java: ["javaee"],
  php: ["phpunit"],
  docker: ["dockerfile", "dockerfiles", "dockerise", "dockerisee", "dockerises", "dockerisees", "dockerisation", "dockerized", "dockerised", "dockerization"],
  jenkins: ["jenkinsfile"],
  soapui: ["soap ui", "soap-ui"],
};

// Occurrences retirées avant de chercher un segment : « soap ui » est l'outil
// SoapUI, pas une mention du protocole SOAP.
const EXCLUSIONS_COMPETENCE: Record<string, RegExp> = {
  soap: /soap[\s-]ui(?=$|[^a-z0-9])/g,
};

function contientSegmentCompetence(texteNormalise: string, segment: string): boolean {
  const t = normaliserTexte(segment).trim();
  if (!t) return false;
  const exclusion = EXCLUSIONS_COMPETENCE[t];
  if (exclusion) texteNormalise = texteNormalise.replace(exclusion, " ");
  // Version accolée autorisée seulement après une lettre (« python3 »), jamais
  // pour un terme qui se termine déjà par un chiffre.
  const version = /[a-z]$/.test(t) ? "(?:\\d+(?:[.,]\\d+)*)?" : "";
  const motif = new RegExp(`(^|[^a-z0-9])${echapper(t)}${version}(?=$|[^a-z0-9])`);
  if (motif.test(texteNormalise)) return true;
  return (VARIANTES_COMPETENCE[t] ?? []).some((v) => contientTerme(texteNormalise, v));
}

export function contientCompetence(texteNormalise: string, competence: string): boolean {
  return competence.split(" / ").some((segment) => contientSegmentCompetence(texteNormalise, segment));
}

const DEVISES: Record<string, string> = { "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR", "$": "USD", usd: "USD", "£": "GBP", gbp: "GBP", chf: "CHF", mad: "MAD", tnd: "TND", dt: "TND" };

export type BudgetExtrait = { montant: number; devise: string | null; journalier: boolean };

// Montant : un nombre accompagné d'un signal monétaire explicite — devise
// juste après (« 550 EUR », « 600€ », « 45 k€ »), mot-clé juste avant
// (« budget 550 », « TJM de 600 », « tarif : 500 ») ou unité journalière
// juste après (« 550 par jour », « 600/j »). Jamais une année, une durée,
// une quantité de personnes ou un nombre d'années d'expérience.
export function extraireBudget(texteNormalise: string): BudgetExtrait | null {
  const motif = /(\d{1,3}(?:[   .]\d{3})+|\d+)(?:[.,](\d+))?\s*(k)?\s*(€|\$|£|eur|euros?|usd|gbp|chf|mad|tnd|dt)?/g;
  let meilleur: { score: number; budget: BudgetExtrait } | null = null;
  for (const m of texteNormalise.matchAll(motif)) {
    const brut = m[1].replace(/[   .]/g, "");
    let montant = Number(brut + (m[2] ? `.${m[2]}` : ""));
    if (!Number.isFinite(montant) || montant <= 0) continue;
    if (m[3]) montant *= 1000;
    const avant = texteNormalise.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0);
    const finIndex = (m.index ?? 0) + m[0].length;
    const apres = texteNormalise.slice(finIndex, finIndex + 20);
    const devise = m[4] ? DEVISES[m[4]] ?? null : null;

    // Exclusions : durées, expérience, effectifs, pourcentages, années.
    if (/^\s*(mois|semaines?|jours? ouvres|ans?\b|annees?|personnes?|profils?|ingenieurs?|developpeurs?|%|h\b|heures?)/.test(apres) && !devise) continue;
    const estAnnee = !devise && !m[3] && /^(19|20)\d{2}$/.test(brut) && !/(budget|tjm|tarif|taux|prix)\s*(de|:|max(imum)?|d'environ|environ)?\s*$/.test(avant);
    if (estAnnee) continue;

    const journalier = /^\s*(\/\s*j(our)?\b|par jour|\/jour|ht\s*\/\s*j|ht par jour|jour|journalier)/.test(apres) || /(tjm|taux journalier)\s*(de|:|max(imum)?|d'environ|environ|a)?\s*$/.test(avant);
    const motCle = /(budget|tjm|tarif|taux|prix|enveloppe|cout|remuneration)[^.\d]{0,20}$/.test(avant);

    let score = 0;
    if (devise) score += 3;
    if (journalier) score += 2;
    if (motCle) score += 2;
    if (m[3]) score += 1;
    if (score === 0) continue; // nombre sans aucun signal monétaire : ignoré
    if (!meilleur || score > meilleur.score) meilleur = { score, budget: { montant, devise, journalier } };
  }
  return meilleur?.budget ?? null;
}

const MOTS_NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, dixhuit: 18, vingt: 20 };

// Durée d'une mission ou d'un projet : « 6 mois », « six mois »,
// « 12 semaines », « pendant 2 ans » — jamais « 5 ans d'expérience ».
export function extraireDuree(texteNormalise: string): string | null {
  const motif = /(\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|vingt)\s*(mois|semaines?|ans?|annees?)\b(?!\s+d['’ ]?\s*experience)/g;
  for (const m of texteNormalise.matchAll(motif)) {
    const unite = m[2];
    const avant = texteNormalise.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    // « ans » seul est ambigu (âge, ancienneté) : exigé avec un contexte de durée.
    if (/^an/.test(unite) && !/(pendant|durant|pour|sur|duree de|mission de|projet de|contrat de)\s*$/.test(avant)) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : MOTS_NOMBRES[m[1]];
    if (!n) continue;
    const uniteNormale = /^mois/.test(unite) ? "mois" : /^semaine/.test(unite) ? (n > 1 ? "semaines" : "semaine") : n > 1 ? "ans" : "an";
    return `${n} ${uniteNormale}`;
  }
  return null;
}

const MOIS_AFFICHES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

// Date de début : un mois nommé, avec son année quand elle est écrite
// (« janvier 2027 »). « mai » n'est retenu que comme mot entier.
export function extraireDateDebut(texteNormalise: string): string | null {
  for (const mois of MOIS) {
    const m = texteNormalise.match(new RegExp(`(^|[^a-z0-9])${mois}(?:\\s+(20\\d{2}))?(?=$|[^a-z0-9])`));
    if (m) {
      const affiche = MOIS_AFFICHES[MOIS.indexOf(mois)];
      return m[2] ? `${affiche} ${m[2]}` : affiche;
    }
  }
  return null;
}
