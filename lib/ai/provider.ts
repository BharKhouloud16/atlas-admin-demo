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

export interface AiProvider {
  readonly nom: string; // "local" | "anthropic" | "openai" | "gemini" ...
  analyserTexte(texte: string, competencesConnues: string[]): Promise<SuggestionAnalyse>;
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
