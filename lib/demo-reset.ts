// V1 — réinitialisation contrôlée des mots de passe des comptes de
// démonstration, sur la base Supabase Preview UNIQUEMENT.
//
// Ce module ne contient que des fonctions pures (aucun accès base, aucun
// réseau, aucune variable d'environnement lue ici) : toute la logique de
// refus est testable sans base de données (tests/unit/demo-reset.spec.ts).
// L'exécution est faite par scripts/reinitialiser-comptes-demo.ts.

import { identifierCibleBase } from "./db-target";

// Seule base autorisée : le projet Supabase `atlas-preview`. Cette référence
// apparaît déjà dans l'URL publique du tableau de bord Supabase ; ce n'est
// pas un secret (aucun accès ne peut être obtenu avec elle seule).
export const REFERENCE_PREVIEW_ATTENDUE = "gvehwiukssyeydmerqyd";

export type CompteDemo = { email: string; role: "ADMIN" | "CLIENT" | "INGENIEUR"; variableMotDePasse: string };

// Les trois comptes visés, et eux seuls. `en-attente-demo@example.com` est
// volontairement exclu (compte inactif servant à tester la validation Admin).
export const COMPTES_DEMO: readonly CompteDemo[] = [
  { email: "admin-demo@example.com", role: "ADMIN", variableMotDePasse: "DEMO_RESET_MDP_ADMIN" },
  { email: "client-demo@example.com", role: "CLIENT", variableMotDePasse: "DEMO_RESET_MDP_CLIENT" },
  { email: "ingenieur-demo@example.com", role: "INGENIEUR", variableMotDePasse: "DEMO_RESET_MDP_INGENIEUR" },
] as const;

// Même règle de longueur minimale que l'inscription (lib/validation.ts,
// lib/password-policy.ts). La vérification HaveIBeenPwned de l'application
// n'est pas reprise ici (aucun appel réseau depuis le script).
export const LONGUEUR_MIN_MOT_DE_PASSE = 8;

// Coût bcrypt identique à celui de l'application (signup, changement et
// réinitialisation de mot de passe, seed : bcrypt.hash(…, 12)). La connexion
// utilise bcrypt.compare, qui lit le coût dans le hash : compatible.
export const COUT_BCRYPT = 12;

export type Resultat = { ok: true } | { ok: false; raison: string };

// Référence Supabase lue dans l'hôte (connexion directe db.<ref>.supabase.co)
// ou dans l'utilisateur du pooler (postgres.<ref>@…pooler.supabase.com).
export function extraireReferenceSupabase(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return null;
  const hote = u.hostname;
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(hote)?.[1];
  if (direct) return direct;
  if (hote.endsWith(".pooler.supabase.com")) {
    return /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1] ?? null;
  }
  return null;
}

export type EnvironnementCible = {
  urlBase: string | undefined;
  confirmation: string | undefined; // ATLAS_CONFIRMER_CIBLE
  vercelEnv: string | undefined; // VERCEL_ENV
};

// Refuse toute cible qui n'est pas, de façon vérifiable, la base Preview.
// Trois contrôles indépendants doivent tous concorder :
//   1. confirmation explicite de l'opérateur = référence attendue ;
//   2. référence extraite de l'URL de connexion = référence attendue ;
//   3. empreinte calculée par lib/db-target.ts = « supabase-atlas-preview ».
// Le message de refus ne contient jamais l'URL ni aucun fragment de celle-ci.
export function verifierCiblePreview(env: EnvironnementCible): Resultat {
  if (env.vercelEnv === "production") {
    return { ok: false, raison: "VERCEL_ENV=production : exécution interdite." };
  }
  if (!env.confirmation) {
    return { ok: false, raison: "Confirmation absente : définir ATLAS_CONFIRMER_CIBLE avec la référence du projet Preview." };
  }
  if (env.confirmation !== REFERENCE_PREVIEW_ATTENDUE) {
    return { ok: false, raison: "ATLAS_CONFIRMER_CIBLE ne correspond pas à la référence Preview attendue." };
  }
  if (!env.urlBase) {
    return { ok: false, raison: "DATABASE_URL absente." };
  }
  const reference = extraireReferenceSupabase(env.urlBase);
  if (!reference) {
    return { ok: false, raison: "DATABASE_URL ne désigne pas une base Supabase identifiable (référence introuvable)." };
  }
  if (reference !== REFERENCE_PREVIEW_ATTENDUE) {
    return { ok: false, raison: "DATABASE_URL désigne un autre projet Supabase que la Preview : exécution interdite." };
  }
  const cible = identifierCibleBase(env.urlBase);
  if (cible.libelle !== "supabase-atlas-preview") {
    return { ok: false, raison: "Contrôle d'empreinte incohérent : exécution interdite." };
  }
  return { ok: true };
}

// Lit les mots de passe dans l'objet d'environnement fourni. Ne renvoie jamais
// la valeur dans un message d'erreur.
export function lireMotsDePasse(
  env: Record<string, string | undefined>
): { ok: true; motsDePasse: Map<string, string> } | { ok: false; raison: string } {
  const motsDePasse = new Map<string, string>();
  for (const compte of COMPTES_DEMO) {
    const valeur = env[compte.variableMotDePasse];
    if (!valeur) return { ok: false, raison: `${compte.variableMotDePasse} absente.` };
    if (valeur.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      return { ok: false, raison: `${compte.variableMotDePasse} : au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères requis.` };
    }
    if (valeur !== valeur.trim()) {
      return { ok: false, raison: `${compte.variableMotDePasse} : espaces en début ou fin de valeur refusés.` };
    }
    motsDePasse.set(compte.email, valeur);
  }
  return { ok: true, motsDePasse };
}

export type EtatCompte = {
  id: string;
  email: string;
  role: string;
  actif: boolean;
  emailVerifie: boolean;
  desactive: boolean;
  totpActif: boolean;
};

// Précontrôle complet, avant toute écriture : les trois comptes existent
// (une seule ligne chacun), ont le rôle attendu et rempliraient toutes les
// conditions de connexion une fois le mot de passe corrigé.
export function precontrolerComptes(lignes: EtatCompte[]): Resultat {
  const erreurs: string[] = [];
  for (const compte of COMPTES_DEMO) {
    const trouves = lignes.filter((l) => l.email === compte.email);
    if (trouves.length === 0) {
      erreurs.push(`${compte.email} : introuvable.`);
      continue;
    }
    if (trouves.length > 1) {
      erreurs.push(`${compte.email} : plusieurs lignes.`);
      continue;
    }
    const l = trouves[0];
    if (l.role !== compte.role) erreurs.push(`${compte.email} : rôle ${l.role}, attendu ${compte.role}.`);
    if (!l.actif) erreurs.push(`${compte.email} : compte inactif (actif=false).`);
    if (!l.emailVerifie) erreurs.push(`${compte.email} : email non confirmé.`);
    if (l.desactive) erreurs.push(`${compte.email} : compte désactivé par l'utilisateur.`);
    if (l.totpActif) erreurs.push(`${compte.email} : double authentification active (code requis à la connexion).`);
  }
  const inattendus = lignes.filter((l) => !COMPTES_DEMO.some((c) => c.email === l.email));
  if (inattendus.length > 0) erreurs.push(`${inattendus.length} ligne(s) hors périmètre reçue(s) : refus.`);
  return erreurs.length === 0 ? { ok: true } : { ok: false, raison: erreurs.join(" ") };
}
