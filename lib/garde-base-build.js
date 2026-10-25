// Garde-fou Production / base Preview — contrôle au BUILD (next.config.js),
// en CommonJS car chargé par Next.js avant toute compilation TypeScript.
// Même calcul d'empreinte que lib/db-target.ts (parité vérifiée par
// tests/unit/garde-base.spec.ts) : référence de projet Supabase lue dans
// l'hôte db.<ref>.supabase.co ou l'utilisateur postgres.<ref> du pooler.
const { createHash } = require("crypto");

const EMPREINTES_INTERDITES_EN_PRODUCTION = ["49f2c2496085c867"]; // supabase-atlas-preview

function empreinteSupabase(url) {
  if (!url) return null;
  let hote;
  let utilisateur;
  try {
    const u = new URL(url);
    hote = u.hostname;
    utilisateur = decodeURIComponent(u.username);
  } catch {
    return null;
  }
  const ref =
    /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(hote)?.[1] ??
    (hote.endsWith(".supabase.com") || hote.endsWith(".supabase.co") ? /^postgres\.([a-z0-9]{20})$/.exec(utilisateur)?.[1] : undefined);
  return ref ? createHash("sha256").update(`atlas-db:${ref}`).digest("hex").slice(0, 16) : null;
}

// Lève une erreur (build en échec) si un build Production vise une base interdite.
function verifierCibleBuildProduction(env) {
  if (env.VERCEL_ENV !== "production") return;
  const empreinte = empreinteSupabase(env.DATABASE_URL);
  if (empreinte && EMPREINTES_INTERDITES_EN_PRODUCTION.includes(empreinte)) {
    throw new Error("Build Production refusé : DATABASE_URL vise la base Preview (atlas-preview).");
  }
}

module.exports = { EMPREINTES_INTERDITES_EN_PRODUCTION, empreinteSupabase, verifierCibleBuildProduction };
