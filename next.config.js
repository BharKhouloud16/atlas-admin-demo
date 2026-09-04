/** @type {import('next').NextConfig} */

// En-têtes de sécurité — absents jusqu'ici (aucun next.config.js n'existait).
// CSP volontairement stricte sur script-src (l'app n'a aucun script inline
// ni tiers) mais tolérante sur style-src ('unsafe-inline') car toute la UI
// utilise des style={{...}} React, qui deviennent des attributs style="..."
// — ceux-ci nécessitent 'unsafe-inline' en CSP quel que soit le framework.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
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
