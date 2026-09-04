// Taux de change EUR live, remplaçant partiellement les taux fixes de
// lib/localisation.ts (TAUX_VERS_EUR) — appelés "gaps techniques" par
// l'utilisatrice le 4 sept. : "multi-devise réel avec taux de change live
// plutôt que les taux fixes actuels".
//
// Source : Frankfurter (https://www.frankfurter.app, données Banque
// Centrale Européenne, gratuit, sans clé). LIMITE IMPORTANTE : la BCE ne
// publie pas de taux de référence pour le dirham marocain (MAD), le dinar
// tunisien (TND), le dinar algérien (DZD), le dirham émirien (AED), le
// riyal saoudien (SAR) ni le riyal qatari (QAR) — Frankfurter ne les
// couvre donc pas. Pour ces devises on garde le taux fixe indicatif de
// lib/localisation.ts (documenté comme tel), et seules EUR/USD/GBP/CHF/CAD
// passent en taux live. C'est un compromis honnête plutôt qu'un taux "live"
// inventé pour des devises que la source ne couvre pas.
//
// Mis en cache en mémoire (process serverless) pendant CACHE_DUREE_MS pour
// éviter un appel réseau à chaque rendu de /admin/profils — un taux de
// change n'a pas besoin d'être à la seconde près pour cet usage (ordre de
// grandeur de comparaison, pas de la facturation réelle).

export type TauxChange = Record<string, number>;

const DEVISES_LIVE = ["USD", "GBP", "CHF", "CAD"];
const CACHE_DUREE_MS = 60 * 60 * 1000; // 1h

// Repris de lib/localisation.ts : sert à la fois de valeur de repli si
// l'appel réseau échoue, et de taux pour les devises non couvertes par
// Frankfurter (MAD/TND/DZD/AED/SAR/QAR).
const TAUX_REPLI: TauxChange = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.04,
  MAD: 0.092,
  TND: 0.3,
  DZD: 0.0069,
  AED: 0.25,
  SAR: 0.245,
  QAR: 0.252,
  CAD: 0.68,
};

let cache: { taux: TauxChange; recupereLe: number; source: "live" | "repli" } | null = null;

export async function obtenirTauxChange(): Promise<{ taux: TauxChange; source: "live" | "repli"; recupereLe: number }> {
  if (cache && Date.now() - cache.recupereLe < CACHE_DUREE_MS) {
    return cache;
  }

  try {
    const url = `https://api.frankfurter.app/latest?from=EUR&to=${DEVISES_LIVE.join(",")}`;
    const reponse = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!reponse.ok) throw new Error(`Frankfurter a répondu ${reponse.status}`);
    const donnees = (await reponse.json()) as { rates: Record<string, number> };

    // Frankfurter donne "1 EUR = X devise" — convertirEnEur veut l'inverse
    // (X devise = combien d'EUR), donc on inverse chaque taux.
    const tauxVersEur: TauxChange = { EUR: 1, ...TAUX_REPLI };
    for (const devise of DEVISES_LIVE) {
      const tauxEurVersDevise = donnees.rates?.[devise];
      if (tauxEurVersDevise && tauxEurVersDevise > 0) {
        tauxVersEur[devise] = Math.round((1 / tauxEurVersDevise) * 100000) / 100000;
      }
    }

    cache = { taux: tauxVersEur, recupereLe: Date.now(), source: "live" };
    return cache;
  } catch (e) {
    console.error("[taux-change] échec de récupération des taux live, repli sur les taux fixes", e);
    cache = { taux: TAUX_REPLI, recupereLe: Date.now(), source: "repli" };
    return cache;
  }
}
