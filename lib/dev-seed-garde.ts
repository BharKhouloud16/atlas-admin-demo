// SÉCURITÉ — /api/dev-seed (voir app/api/dev-seed/route.ts).
//
// La route crée des comptes de démonstration, dont un compte ADMIN, sur la
// base de l'environnement qui la sert. Protégée par SEED_TOKEN, elle restait
// pourtant joignable en Production (SEED_TOKEN y est défini) : quiconque
// obtient ce jeton — transmis en paramètre d'URL, donc exposé aux journaux
// d'accès et à l'historique du navigateur — pouvait, sur une base de
// Production sans « admin-demo », créer un compte ADMIN et recevoir son mot
// de passe.
//
// Règle minimale : route inexistante (404, avant tout accès à la base) sur
// Vercel Production. Inchangée en CI (VERCEL_ENV absent : tests 403 de
// tests/api/securite-dev-seed.spec.ts) et sur Preview (mécanisme de seed
// documenté de la base Preview). La PR #55 supprime la route entièrement ;
// cette garde en est un sous-ensemble compatible.
export function devSeedDisponible(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
