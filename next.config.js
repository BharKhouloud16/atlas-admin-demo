/** @type {import('next').NextConfig} */

// En-têtes de sécurité — absents jusqu'ici (aucun next.config.js n'existait).
// CSP volontairement stricte sur script-src (l'app n'a aucun script tiers)
// mais tolérante sur style-src ('unsafe-inline') car toute la UI utilise des
// style={{...}} React, qui deviennent des attributs style="..." — ceux-ci
// nécessitent 'unsafe-inline' en CSP quel que soit le framework.
//
// script-src DOIT aussi inclure 'unsafe-inline' : le App Router de Next.js
// (voir app/) injecte lui-même, à chaque page, des balises <script> INLINE
// sans nonce pour hydrater le payload RSC en streaming (ex.
// `self.__next_f.push(...)`) — indépendant de tout Suspense, présent sur
// TOUTE page App Router. Un script-src 'self' seul (sans 'unsafe-inline' ni
// nonce) bloque ces scripts : la page s'affiche (HTML SSR intact) mais React
// n'hydrate jamais, donc AUCUN gestionnaire d'événement client ne s'attache
// — un clic sur "Se connecter" retombe alors sur la soumission HTML native
// du <form> (GET vers l'URL courante, "/connexion?"), jamais l'appel
// fetch("/api/auth/login"). C'est exactement la cause des 5 échecs
// tests/e2e/connexion.spec.ts (repro confirmée le 06/09) : les tests API
// passent (aucun navigateur impliqué), mais les parcours UI qui dépendent
// d'un clic géré par React restent bloqués sur /connexion. La solution
// propre (nonce CSP par requête) demande de générer un nonce dans le
// middleware et de le propager côté Server Components — hors périmètre de
// ce correctif ciblé ; 'unsafe-inline' reste un compromis correct pour une
// app qui n'exécute déjà aucun script tiers (le risque XSS visé par un
// script-src strict porte surtout sur l'injection de scripts EXTERNES,
// toujours bloquée ici).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  // Nécessaire pour que Next.js charge instrumentation.ts (voir ce fichier —
  // initialise Sentry côté serveur/edge, uniquement si SENTRY_DSN est
  // défini). Sans clé DSN, ce flag n'a aucun effet visible.
  experimental: {
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
