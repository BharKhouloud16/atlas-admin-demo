import { resoudreCompetencesDepuisTexte } from "@/lib/talent/skill-resolution";

// Abstraction provider-neutre pour toute fonctionnalité IA d'ATLAS TALENT
// (AI Request Analyzer, et plus tard Matching Engine / Talent Agent — voir
// lib/talent/). But : le système doit être "AI-native" (conçu pour l'IA dès
// le départ) mais fonctionner correctement SANS aucun fournisseur IA
// configuré (pas de clé API) — voir AiProviderLocal ci-dessous, utilisé par
// défaut. Brancher Claude/OpenAI/Gemini plus tard ne doit demander qu'un
// nouveau fichier implémentant AiProvider + une entrée dans resolverProvider,
// jamais un changement des appelants (lib/talent/analyseur.ts, routes API).
//
// Volontairement minimal à ce stade (fondations) : une seule capacité
// (analyserTexte), pas de Matching Engine ni de Talent Agent IA ici — voir
// lib/talent/matching.ts qui reste un moteur de scoring déterministe,
// consommable par un futur Talent Agent sans dépendre d'un provider IA.

export type SuggestionAnalyse = {
  // Sous-ensemble de lib/competences.ts (TOUTES_COMPETENCES) — jamais une
  // compétence hors liste fermée, pour rester exploitable par le Matching
  // Engine (qui compare des chaînes exactes à Profil.competences).
  competences: string[];
  seniorite: string | null; // "Junior" | "Confirmé" | "Senior" | "Expert" | null si indéterminé
  budgetTjmMax: number | null;
  budgetDevise: string | null;
  confiance: number; // 0-1 — jamais 1.0 pour un provider heuristique/local
  // LOT 11 — ATLAS SKILL INTELLIGENCE V1 : détail de la méthode de détection
  // PAR compétence (voir lib/talent/skill-resolution.ts), en plus de la
  // liste plate `competences` ci-dessus (conservée telle quelle pour la
  // compatibilité des appelants existants, ex. lib/talent/analyseur.ts qui
  // ne lit jamais ce champ). Optionnel : un futur provider tiers qui ne
  // l'implémenterait pas reste pleinement compatible (repli documenté dans
  // lib/talent/skill-graph.ts::construireCompetencesInferees).
  detailCompetences?: { competence: string; methode: "EXACT" | "ALIAS" }[];
};

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Vocabulaire des clés de fait EXTRACTIBLES — sous-ensemble volontaire de
// ClientNeedFaitCle (prisma/schema.prisma) : les clés purement déclaratives/
// répétitives sans heuristique fiable (CONTRAINTE, PRIORITE, RISQUE,
// PREFERENCE) ne sont PAS extraites par le provider local — un heuristique
// par mots-clés ne peut pas les détecter honnêtement, donc il ne prétend
// pas le faire (ne jamais inventer une extraction, directive de la
// mission). Recopié ici en chaîne (pas un import de @prisma/client) : ce
// module reste indépendant de Prisma, comme SuggestionAnalyse ci-dessus.
//
// A6.1 — Outcome Foundation (01/10/2026) : RESULTAT_ATTENDU (singleton) et
// CRITERE_REUSSITE (répétable) rejoignent ce vocabulaire — même discipline
// que les autres clés ci-dessous : uniquement sur signal explicite dans le
// texte, jamais une déduction ni une valeur générique. CRITERE_REUSSITE
// reste répétable (plusieurs lignes possibles par extraction) exactement
// comme COMPETENCE ; voir extraireBesoin() ci-dessous pour le détail.
export type CleFaitBesoinExtractible =
  | "OBJECTIF"
  | "ROLE"
  | "QUANTITE"
  | "SENIORITE"
  | "ANNEES_EXPERIENCE_MIN"
  | "COMPETENCE"
  | "BUDGET_MONTANT"
  | "BUDGET_DEVISE"
  | "BUDGET_TYPE"
  | "DUREE"
  | "DATE_DEBUT"
  | "DISPONIBILITE"
  | "LOCALISATION"
  | "REMOTE"
  | "RESULTAT_ATTENDU"
  | "CRITERE_REUSSITE"
  | "HYPOTHESE_DOMAINE_SOLUTION";

export type FaitBesoinExtrait = {
  cle: CleFaitBesoinExtractible;
  valeur: string;
  // DECLARE : le texte du client l'énonce explicitement.
  // INFERE : déduit sans que le client l'ait écrit tel quel — TOUJOURS le
  // statut de HYPOTHESE_DOMAINE_SOLUTION (jamais DECLARE, jamais VERIFIE :
  // seule une correction humaine explicite, hors périmètre LOT 2, pourrait
  // y mener plus tard).
  statut: "DECLARE" | "INFERE";
};

export type SuggestionBesoin = {
  faits: FaitBesoinExtrait[];
  confiance: number; // 0-1 — jamais 1.0 pour un provider heuristique/local
};

export interface AiProvider {
  readonly nom: string; // "local" | "anthropic" | "openai" | "gemini" ...
  analyserTexte(texte: string, competencesConnues: string[]): Promise<SuggestionAnalyse>;
  // LOT 2 — additive à l'interface existante (même principe que documenté
  // en tête de fichier : brancher un vrai provider ne doit demander qu'une
  // implémentation de cette méthode, jamais un changement des appelants).
  extraireBesoin(texte: string, competencesConnues: string[], paysConnus: string[]): Promise<SuggestionBesoin>;
}

// Provider par défaut, sans aucune dépendance réseau ni clé API : extraction
// par correspondance de mots-clés contre la liste fermée de compétences
// (lib/competences.ts) + quelques heuristiques simples pour la séniorité et
// le budget. Peu précis par nature (d'où confiance plafonnée), mais garantit
// que la fonctionnalité marche "day one" avant toute intégration IA, et sert
// de filet de repli si un provider IA configuré échoue (voir résolveur
// ci-dessous).
class AiProviderLocal implements AiProvider {
  readonly nom = "local";

  async analyserTexte(texte: string, competencesConnues: string[]): Promise<SuggestionAnalyse> {
    const normalise = texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // LOT 11 -- remplace l'ancienne recherche de sous-chaine brute
    // (`normalise.includes(segment)`) par lib/talent/skill-resolution.ts :
    // correspondance par mot entier (elimine le faux positif "PostgreSQL"
    // -> "SQL" documente au Lot 10) + reconnaissance explicite de quelques
    // variantes d'ecriture usuelles (K8s, JS, TS, React.js, ReactJS).
    const detailCompetences = resoudreCompetencesDepuisTexte(texte, competencesConnues).map((r) => ({
      competence: r.competence,
      methode: r.methode,
    }));
    const competences = detailCompetences.map((d) => d.competence);

    const SENIORITES: { motCle: string; valeur: string }[] = [
      { motCle: "junior", valeur: "Junior" },
      { motCle: "confirme", valeur: "Confirmé" },
      { motCle: "senior", valeur: "Senior" },
      { motCle: "expert", valeur: "Expert" },
      { motCle: "lead", valeur: "Expert" },
    ];
    const seniorite = SENIORITES.find((s) => normalise.includes(s.motCle))?.valeur ?? null;

    // Cherche un nombre suivi (ou précédé) d'un indice de TJM/budget ("TJM
    // 600", "600€/j", "budget 550 usd") — heuristique volontairement simple.
    const matchBudget = normalise.match(/(\d{2,4})\s*(eur|usd|gbp|€|\$|£)?/);
    const budgetTjmMax = matchBudget ? Number(matchBudget[1]) : null;
    const deviseParSymbole: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP" };
    const budgetDevise = matchBudget?.[2]
      ? deviseParSymbole[matchBudget[2]] ?? matchBudget[2].toUpperCase()
      : null;

    // Confiance basse et déterministe : reflète honnêtement qu'il s'agit
    // d'une extraction par mots-clés, pas d'une compréhension du texte —
    // l'Admin doit revoir avant tout matching (voir statut ANALYSEE).
    const confiance = competences.length > 0 || seniorite ? 0.4 : 0.15;

    return { competences, seniorite, budgetTjmMax, budgetDevise, confiance, detailCompetences };
  }

  // LOT 2 — Client Need Intelligence Foundation. Extraction heuristique
  // volontairement simple (mots-clés/regex), même discipline que
  // analyserTexte ci-dessus : jamais une compréhension réelle du texte,
  // toujours DECLARE (jamais INFERE) pour ce qui est détecté tel quel dans
  // le texte, sauf HYPOTHESE_DOMAINE_SOLUTION qui est TOUJOURS INFERE (une
  // déduction, jamais une lecture directe). Un attribut non détecté n'est
  // JAMAIS émis avec une valeur inventée — son absence dans `faits` EST la
  // représentation de "inconnu" (l'appelant décide s'il crée ou non une
  // ligne ClientNeedFait statut=INCONNU pour les attributs importants).
  async extraireBesoin(texte: string, competencesConnues: string[], paysConnus: string[]): Promise<SuggestionBesoin> {
    const normalise = texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const faits: FaitBesoinExtrait[] = [];
    const ajouter = (cle: CleFaitBesoinExtractible, valeur: string, statut: "DECLARE" | "INFERE" = "DECLARE") =>
      faits.push({ cle, valeur, statut });

    // ROLE — petite liste fermée volontairement minimale (best-effort,
    // aucune prétention d'exhaustivité) : aucun vocabulaire de rôle
    // n'existe encore ailleurs dans le repository (TOUTES_COMPETENCES ne
    // couvre que les compétences techniques, pas les intitulés de poste).
    const ROLES_CONNUS = [
      "qa automation", "qa", "testeur", "developpeur", "developer", "devops",
      "architecte", "product owner", "scrum master", "data engineer",
      "data scientist", "ux designer", "ui designer", "chef de projet", "lead",
    ];
    const roleTrouve = ROLES_CONNUS.find((r) => normalise.includes(r));
    if (roleTrouve) ajouter("ROLE", roleTrouve);

    // QUANTITE — chiffre ou nombre en toutes lettres (1 à 10), cherché près
    // du rôle détecté pour limiter les faux positifs (éviter de confondre
    // avec "6 mois" ou "10 ans d'expérience").
    const MOTS_NOMBRES: Record<string, number> = {
      un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
    };
    if (roleTrouve) {
      const fenetre = normalise.slice(0, normalise.indexOf(roleTrouve) + roleTrouve.length + 3);
      const matchChiffre = fenetre.match(/(\d{1,2})\s+\S*$/);
      const motNombre = Object.keys(MOTS_NOMBRES).find((m) => fenetre.includes(` ${m} `) || fenetre.startsWith(`${m} `));
      const quantite = matchChiffre ? Number(matchChiffre[1]) : motNombre ? MOTS_NOMBRES[motNombre] : null;
      if (quantite) ajouter("QUANTITE", String(quantite));
    }

    // SENIORITE — même table que analyserTexte, jamais dupliquée en
    // divergeant : recopiée ici car privée à la méthode ci-dessus, mais
    // identique valeur pour valeur.
    const SENIORITES: { motCle: string; valeur: string }[] = [
      { motCle: "junior", valeur: "Junior" },
      { motCle: "confirme", valeur: "Confirmé" },
      { motCle: "senior", valeur: "Senior" },
      { motCle: "expert", valeur: "Expert" },
      { motCle: "lead", valeur: "Expert" },
    ];
    const seniorite = SENIORITES.find((s) => normalise.includes(s.motCle));
    if (seniorite) ajouter("SENIORITE", seniorite.valeur);

    // ANNEES_EXPERIENCE_MIN — distinct de DUREE (mission) : uniquement
    // "X ans/années d'expérience", jamais un simple "X ans" isolé (trop
    // ambigu avec une durée de mission).
    const matchExperience = normalise.match(/(\d{1,2})\s*(ans?|annees?)\s+d[' ]experience/);
    if (matchExperience) ajouter("ANNEES_EXPERIENCE_MIN", matchExperience[1]);

    // COMPETENCE — répétable, une ligne par compétence reconnue (même
    // liste fermée que analyserTexte).
    for (const c of competencesConnues) {
      const cNormalise = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (cNormalise.split(" / ").some((segment) => normalise.includes(segment.trim()))) {
        ajouter("COMPETENCE", c);
      }
    }

    // DUREE — "pendant/durant X mois/semaines/ans", contexte explicite
    // requis pour ne jamais confondre avec ANNEES_EXPERIENCE_MIN.
    const matchDuree = normalise.match(/(?:pendant|durant)\s+(\d{1,3})\s*(mois|semaines?|ans?|annees?)/);
    if (matchDuree) ajouter("DUREE", `${matchDuree[1]} ${matchDuree[2]}`);

    // DATE_DEBUT — mois nommé explicitement, jamais déduit d'une date
    // relative ("bientôt", "rapidement" relève de DISPONIBILITE ci-dessous).
    const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
    const moisTrouve = MOIS.find((m) => normalise.includes(m));
    if (moisTrouve) ajouter("DATE_DEBUT", moisTrouve);

    // DISPONIBILITE — mots-clés explicites uniquement.
    if (/(immediat|des que possible|au plus vite|rapidement)/.test(normalise)) {
      ajouter("DISPONIBILITE", "Disponible immédiatement");
    }

    // LOCALISATION — réutilise lib/localisation.ts (PAYS), jamais une
    // nouvelle liste de villes/pays inventée pour ce lot.
    const paysTrouve = paysConnus.find((p) => p !== "Autre" && normalise.includes(p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
    if (paysTrouve) ajouter("LOCALISATION", paysTrouve);

    // REMOTE — signal explicite uniquement, jamais déduit de l'absence de
    // mention "sur site".
    if (/(remote|teletravail|a distance)/.test(normalise)) ajouter("REMOTE", "Remote possible");
    else if (/sur site/.test(normalise)) ajouter("REMOTE", "Sur site");

    // BUDGET — mêmes 4 clés génériques (Talent ET ATLAS OS), voir revue
    // architecturale point 1. BUDGET_TYPE n'est émis QUE si un signal
    // explicite existe (TJM/forfait/abonnement) — jamais deviné par défaut.
    const matchBudget = normalise.match(/(\d{2,5})\s*(eur|usd|gbp|€|\$|£)?/);
    if (matchBudget) {
      ajouter("BUDGET_MONTANT", matchBudget[1]);
      const deviseParSymbole: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP" };
      if (matchBudget[2]) ajouter("BUDGET_DEVISE", deviseParSymbole[matchBudget[2]] ?? matchBudget[2].toUpperCase());
      if (/tjm|journalier|jour/.test(normalise)) ajouter("BUDGET_TYPE", "TJM");
      else if (/forfait/.test(normalise)) ajouter("BUDGET_TYPE", "FORFAIT");
      else if (/abonnement/.test(normalise)) ajouter("BUDGET_TYPE", "ABONNEMENT");
    }

    // A6.1 — Outcome Foundation (01/10/2026). RESULTAT_ATTENDU — signal
    // explicite uniquement ("nous voulons/souhaitons/cherchons à...",
    // "l'objectif est de..."), jamais une déduction du sujet général du
    // texte : capture uniquement ce qui suit le signal, jusqu'à la
    // ponctuation de fin (. ! ? ; ou fin de texte) — jamais un résumé, une
    // reformulation ou une invention. Opère sur `texte` (pas `normalise`)
    // pour préserver la casse/accents d'origine dans la valeur capturée.
    // Si aucun signal n'est trouvé, RESULTAT_ATTENDU reste absent (jamais
    // de valeur par défaut) — son absence est ensuite traitée comme une
    // clarification recommandée, jamais bloquante (voir
    // CLES_IMPORTANTES_SI_ABSENTES, lib/client-need/extraction.ts).
    const SIGNAUX_RESULTAT_ATTENDU = [
      /nous (?:voulons|souhaitons|aimerions|cherchons [aà])\s+([^.!?;\n]{5,200})/i,
      /(?:l[' ]objectif|notre objectif|le but)\s+est\s+de\s+([^.!?;\n]{5,200})/i,
    ];
    for (const regex of SIGNAUX_RESULTAT_ATTENDU) {
      const m = texte.match(regex);
      if (m && m[1].trim().length >= 5) {
        ajouter("RESULTAT_ATTENDU", m[1].trim().slice(0, 200));
        break;
      }
    }

    // CRITERE_REUSSITE — répétable, même discipline : uniquement sur
    // signal explicite ("critère(s) de réussite/succès...", "on saura que
    // c'est réussi si...", "le succès sera mesuré par..."), jamais une
    // déduction. Le texte capturé est découpé en instances distinctes sur
    // les séparateurs d'énumération usuels (point-virgule, virgule, " et ")
    // — simple découpage mécanique du texte littéral, jamais une
    // compréhension de son contenu (ne construit pas un moteur NLP,
    // directive de la mission A6.1 §7). Plafonné à 5 instances pour éviter
    // une sur-segmentation artificielle d'une phrase mal ponctuée.
    const SIGNAUX_CRITERE_REUSSITE = [
      /crit[eè]res?\s+de\s+r[ée]ussite\s*:?\s*([^.!?\n]{5,300})/i,
      /crit[eè]res?\s+de\s+succ[eè]s\s*:?\s*([^.!?\n]{5,300})/i,
      /on\s+saura\s+que\s+c.?est\s+r[ée]ussi\s+si\s+([^.!?\n]{5,300})/i,
      /le\s+succ[eè]s\s+sera\s+mesur[ée]\s+par\s+([^.!?\n]{5,300})/i,
    ];
    for (const regex of SIGNAUX_CRITERE_REUSSITE) {
      const m = texte.match(regex);
      if (m) {
        const instances = m[1]
          .split(/;|,| et /i)
          .map((s) => s.trim())
          .filter((s) => s.length >= 3)
          .slice(0, 5);
        for (const instance of instances) ajouter("CRITERE_REUSSITE", instance.slice(0, 200));
        break;
      }
    }

    // HYPOTHESE_DOMAINE_SOLUTION — TOUJOURS INFERE, jamais DECLARE : c'est
    // par construction une déduction, jamais une lecture directe. Signal
    // Talent = rôle/compétence/séniorité détecté ; signal ATLAS OS = mots-
    // clés de service (audit/sécurité/qualité) SANS aucun signal Talent.
    const signalTalent = Boolean(roleTrouve || faits.some((f) => f.cle === "COMPETENCE") || seniorite);
    const signalAtlasOs = /(audit|securite|cybersecurite|qualite logicielle|assessment)/.test(normalise);
    if (signalTalent && signalAtlasOs) ajouter("HYPOTHESE_DOMAINE_SOLUTION", "BOTH", "INFERE");
    else if (signalTalent) ajouter("HYPOTHESE_DOMAINE_SOLUTION", "TALENT", "INFERE");
    else if (signalAtlasOs) ajouter("HYPOTHESE_DOMAINE_SOLUTION", "ATLAS_OS", "INFERE");
    else ajouter("HYPOTHESE_DOMAINE_SOLUTION", "INCONNU", "INFERE");

    const confianceBesoin = faits.filter((f) => f.cle !== "HYPOTHESE_DOMAINE_SOLUTION").length >= 3 ? 0.4 : 0.2;

    return { faits, confiance: confianceBesoin };
  }
}

// Résolution du provider actif à partir de la configuration d'environnement
// — jamais de clé API en dur dans le code (voir consignes sécurité projet).
// Aucune variable définie -> provider local (fonctionne "day one"). Les
// providers réels (Anthropic/OpenAI/Gemini) ne sont volontairement PAS
// implémentés à ce stade des fondations ATLAS TALENT ; ce résolveur est prêt
// à les accueillir sans changer les appelants.
export function resoudreAiProvider(): AiProvider {
  const nomConfigure = process.env.AI_PROVIDER?.toLowerCase();
  // Aucun provider tiers implémenté pour l'instant (fondations) : on retombe
  // toujours sur le provider local, quelle que soit la valeur demandée,
  // plutôt que de planter si AI_PROVIDER pointe vers un provider pas encore
  // écrit.
  if (nomConfigure && nomConfigure !== "local") {
    console.warn(
      `[ai/provider] AI_PROVIDER="${nomConfigure}" demandé mais aucun provider de ce nom n'est encore implémenté — utilisation du provider local.`
    );
  }
  return new AiProviderLocal();
}
