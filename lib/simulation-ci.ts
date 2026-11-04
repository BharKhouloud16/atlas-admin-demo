// SIMULATIONS RÉSERVÉES À LA CI — stockage du CV et extraction déterministe.
//
// En CI (base jetable), ni Vercel Blob (BLOB_READ_WRITE_TOKEN) ni l'API
// Claude (ANTHROPIC_API_KEY) ne sont disponibles : le parcours Ingénieur
// « import CV → extraction → validation » ne pouvait pas être testé de bout
// en bout. Ces simulations le rendent testable sans aucun service externe.
//
// Activation : les TROIS conditions suivantes sont exigées.
//   1. ATLAS_SIMULATIONS_CI vaut exactement « oui » ;
//   2. CI vaut exactement « true » (positionné par GitHub Actions) ;
//   3. aucune variable Vercel (VERCEL, VERCEL_ENV, VERCEL_URL) : sur Vercel,
//      Preview comme Production, ces variables sont toujours définies, donc
//      les simulations sont impossibles à activer, même si les deux autres
//      variables y étaient définies par erreur.
// Hors activation, le parcours réel est inchangé : un stockage ou une IA non
// configurés échouent exactement comme avant (aucun échec masqué).

export const VARIABLE_SIMULATIONS_CI = "ATLAS_SIMULATIONS_CI";

// Préfixe des URL de fichiers simulés : jamais servies hors simulation active.
export const PREFIXE_URL_SIMULATION = "ci-simulation://";

export function simulationsCiActives(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return false;
  if (env.CI !== "true") return false;
  return env[VARIABLE_SIMULATIONS_CI] === "oui";
}
