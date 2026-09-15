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
};

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Vocabulaire des clés de fait EXTRACTIBLES — sous-ensemble volontaire de
// ClientNeedFaitCle (prisma/schema.prisma) : les clés purement déclaratives/
// répétitives sans heuristique fiable (CONTRAINTE, CRITERE_REUSSITE,
// PRIORITE, RISQUE, PREFERENCE) ne sont PAS extraites par le provider local
// — un heuristique par mots-clés ne peut pas les détecter honnêtement, donc
// il ne prétend pas le faire (ne jamais inventer une extraction, directive
// de la mission). Recopié ici en chaîne (pas un import de @prisma/client) :
// ce module reste indépendant de Prisma, comme SuggestionAnalyse ci-dessus.
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

    const competences = competencesConnues.filter((c) => {
      const cNormalise = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // une compétence composite ("Selenium WebDriver" n'existe pas ici,
      // mais "TestNG / JUnit" oui) : on matche si l'un des segments "/" est présent
      return cNormalise.split(" / ").some((segment) => normalise.includes(segment.trim()));
    });

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

    return { competences, seniorite, budgetTjmMax, budgetDevise, confiance };
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
