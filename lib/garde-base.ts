import { identifierCibleBase } from "@/lib/db-target";

// Garde-fou : un déploiement Production ne doit jamais utiliser la base
// Preview (atlas-preview). Deux signaux indépendants :
//
// 1. Cible de connexion (au build, voir lib/garde-base-build.js, puis avant
//    toute connexion à l'exécution) : empreinte de la référence
//    de projet Supabase lue dans DATABASE_URL (hôte db.<ref>.supabase.co ou
//    utilisateur postgres.<ref> du pooler, voir lib/db-target.ts) — pas le
//    nom de la base, identique (« postgres ») sur tous les projets Supabase.
// 2. Marqueur dans la base elle-même (au premier accès) : la base Preview
//    porte atlas_meta.environnement = 'preview', dans un schéma que Prisma
//    ignore. Ce signal tient même si la base est atteinte par une autre
//    adresse (proxy, IP, nouveau pooler) que l'empreinte ne reconnaîtrait pas.
//
// Hors Production (Preview, CI, local), aucun contrôle et aucun coût.

// Empreintes (lib/db-target.ts) des bases interdites en Production : liste
// unique, partagée avec le contrôle au build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const EMPREINTES_INTERDITES_EN_PRODUCTION: string[] = require("./garde-base-build").EMPREINTES_INTERDITES_EN_PRODUCTION;

export const REQUETE_MARQUEUR = `SELECT nom FROM atlas_meta.environnement LIMIT 1`;

// process.env ou un objet de test équivalent.
type Env = Record<string, string | undefined>;

export function estProduction(env: Env): boolean {
  return env.VERCEL_ENV === "production";
}

// Signal 1. Renvoie le motif de refus, ou null si la cible est acceptable.
export function refusCibleProduction(env: Env): string | null {
  if (!estProduction(env)) return null;
  const cible = identifierCibleBase(env.DATABASE_URL);
  if (cible.empreinte && EMPREINTES_INTERDITES_EN_PRODUCTION.includes(cible.empreinte)) {
    return `Production configurée sur une base interdite (${cible.libelle ?? cible.empreinte}) : connexion refusée.`;
  }
  return null;
}

// Signal 2. `marqueur` : valeur lue dans atlas_meta.environnement, ou null si
// le schéma ou la table n'existent pas (base de Production : jamais de marqueur).
export function refusMarqueurProduction(env: Env, marqueur: string | null): string | null {
  if (!estProduction(env)) return null;
  if (marqueur !== null && marqueur.trim().toLowerCase() !== "production") {
    return `Production connectée à une base marquée « ${marqueur} » : accès refusé.`;
  }
  return null;
}

// Erreur Postgres « relation inexistante » (42P01) ou « schéma inexistant »
// (3F000) : la base n'a pas de marqueur, ce qui est le cas normal hors Preview.
export function estAbsenceMarqueur(erreur: unknown): boolean {
  const code = (erreur as { meta?: { code?: string }; code?: string })?.meta?.code ?? (erreur as { code?: string })?.code;
  const message = String((erreur as { message?: string })?.message ?? "");
  return code === "42P01" || code === "3F000" || /atlas_meta(\.environnement)?" does not exist/.test(message);
}

export class BaseInterditeEnProduction extends Error {}
