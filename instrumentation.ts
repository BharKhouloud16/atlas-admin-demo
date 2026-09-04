// Point d'entrée standard Next.js (App Router) pour initialiser du code au
// démarrage du serveur — utilisé ici pour brancher Sentry (monitoring
// d'erreurs, "gap technique" demandé le 4 sept.) SEULEMENT si la variable
// d'environnement SENTRY_DSN est définie sur Vercel. Sans DSN configuré,
// register() ne fait rien : aucune dépendance sur un service externe tant
// qu'il n'est pas explicitement activé.
//
// Portée volontairement limitée au serveur et à l'edge runtime (pas de
// capture d'erreurs côté navigateur) : activer aussi Sentry côté client
// demanderait d'envelopper next.config.js avec withSentryConfig et de
// fournir un SENTRY_AUTH_TOKEN pour l'upload des source maps au build — non
// disponible dans cet environnement de développement. Cette limite est
// assumée plutôt que de risquer de casser le build sur un token absent.
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
