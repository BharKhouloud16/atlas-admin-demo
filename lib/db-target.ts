import { createHash } from "crypto";

// V1 — identification NON SENSIBLE de la base ciblée par un environnement
// (Production / Preview / local / CI), sans jamais exposer DATABASE_URL.
//
// Les variables Vercel « Sensitive » ne sont pas relisibles : pour savoir
// quelle base un déploiement utilise réellement À L'EXÉCUTION, l'application
// calcule elle-même une empreinte (SHA-256 tronqué) de la référence de projet
// Supabase présente dans l'hôte (db.<ref>.supabase.co) ou dans l'utilisateur
// du pooler (postgres.<ref>). Ni l'hôte, ni l'utilisateur, ni le mot de passe
// ne sont renvoyés ; seule l'empreinte et, si elle est connue, un libellé.

// Empreintes des projets Supabase connus (calculées hors ligne avec
// empreinteReference) — les références elles-mêmes ne sont pas versionnées.
export const EMPREINTES_CONNUES: Record<string, string> = {
  "2f97519aeaf98180": "supabase-historique",
  "49f2c2496085c867": "supabase-atlas-preview",
};

export function empreinteReference(reference: string): string {
  return createHash("sha256").update(`atlas-db:${reference}`).digest("hex").slice(0, 16);
}

export type CibleBase = {
  type: "supabase" | "local" | "autre" | "absente" | "invalide";
  empreinte: string | null;
  libelle: string | null;
};

export function identifierCibleBase(url: string | undefined | null): CibleBase {
  if (!url) return { type: "absente", empreinte: null, libelle: null };
  let hote: string;
  let utilisateur: string;
  try {
    const u = new URL(url);
    hote = u.hostname;
    utilisateur = decodeURIComponent(u.username);
  } catch {
    return { type: "invalide", empreinte: null, libelle: null };
  }
  if (hote === "localhost" || hote === "127.0.0.1" || hote === "::1" || hote === "[::1]") {
    return { type: "local", empreinte: null, libelle: "base-locale" };
  }
  const ref =
    /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(hote)?.[1] ??
    (hote.endsWith(".supabase.com") || hote.endsWith(".supabase.co") ? /^postgres\.([a-z0-9]{20})$/.exec(utilisateur)?.[1] : undefined);
  if (ref) {
    const empreinte = empreinteReference(ref);
    return { type: "supabase", empreinte, libelle: EMPREINTES_CONNUES[empreinte] ?? null };
  }
  return { type: "autre", empreinte: empreinteReference(hote), libelle: null };
}
