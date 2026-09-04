// Initialisation Sentry côté serveur (Node.js) — chargée uniquement par
// instrumentation.ts, uniquement si SENTRY_DSN est défini. Voir ce fichier
// pour le contexte complet.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Échantillonnage des traces de performance à 10% — suffisant pour une
  // démo, évite de saturer le quota gratuit Sentry si activé.
  tracesSampleRate: 0.1,
});
