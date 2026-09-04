// Initialisation Sentry côté edge runtime (middleware.ts) — chargée
// uniquement par instrumentation.ts, uniquement si SENTRY_DSN est défini.
// Voir instrumentation.ts pour le contexte complet.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
