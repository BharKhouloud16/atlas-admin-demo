// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.4, 07/09/2026).
// ASSET / ENTRY POINT / CONTROL MODEL — introduit progressivement ces trois
// concepts, UNIQUEMENT lorsqu'ils sont réellement observables (directive
// B13, section 6 : "uniquement lorsqu'ils sont réellement observables. Pas
// de données inventées. Pas de découverte fictive.").
//
// CE QUE CE MODULE EST : un REGISTRE STATIQUE de faits déjà vérifiés par
// lecture directe du code — chaque entrée cite le fichier réel où le
// mécanisme existe, établi lors de B13.0 (Recovery & Architecture Audit) ou
// des lots B12.7/12.8/13.1-13.3. Ajouter une entrée à ce registre EXIGE
// d'avoir lu le fichier cité — jamais une supposition, jamais une
// extrapolation ("ce type de projet a probablement...").
//
// CE QUE CE MODULE N'EST PAS : PAS un scanner (aucune lecture de fichier à
// l'exécution, aucun parcours du système de fichiers, aucune inspection
// dynamique du code) — la directive B13 section 8 interdit explicitement
// "créer un scanner de vulnérabilités complet" pour ce lot. Ce module ne
// fait QUE structurer, sous forme typée et testable, des faits déjà connus
// et déjà documentés ailleurs dans le code (voir `fichier` sur chaque
// entrée, qui pointe vers la preuve — jamais une preuve fabriquée).
//
// Toute future découverte RÉELLE (ex. un futur connecteur qui inventorie
// vraiment les routes d'un projet CLIENT, directive B13 section 15) sera un
// lot séparé et explicite — ce registre reste, pour B13 V1, le seul actif
// audité : ATLAS OS lui-même (le dépôt atlas-admin-demo), jamais un projet
// tiers.

import type { QualityStatus, QualitySource } from "@/lib/quality/domain";
import { construireObservationSecurite, type SecurityObservation } from "./evidence";
import { estSecurityAssetTypeValide, estSecurityDomaineValide, type SecurityAssetReference, type SecurityDomain } from "./domain";

// RÔLE RBAC associé à un point d'entrée — reprend tel quel le vocabulaire
// de rôle déjà utilisé par lib/auth.ts/middleware.ts (ADMIN/INGENIEUR/
// CLIENT), plus deux valeurs purement descriptives pour les routes qui ne
// vérifient pas de rôle unique : PARTAGE (plusieurs rôles, chacun vérifié
// par la route elle-même — même principe que SHARED_PREFIXES,
// middleware.ts) et PUBLIC (aucune session requise, ex. /connexion).
export type RoleAcces = "ADMIN" | "INGENIEUR" | "CLIENT" | "PARTAGE" | "PUBLIC";

export type SecurityEntryPoint = {
  reference: SecurityAssetReference; // type: "ENDPOINT"
  methode: string; // "GET", "POST", ... — méthode HTTP réellement exportée
  rbac: RoleAcces;
  fichier: string; // chemin réel du fichier implémentant la route
};

export type SecurityControl = {
  id: string;
  label: string;
  domaine: SecurityDomain;
  description: string; // description factuelle du mécanisme, jamais une évaluation ("bon"/"insuffisant")
  fichier: string; // chemin réel du fichier où le contrôle est implémenté
};

// ACTIFS CONNUS — registre statique. Seuls deux actifs sont aujourd'hui
// réellement observables pour ATLAS OS lui-même : l'application et le
// service CI externe qu'elle consulte (voir lib/quality/sources/ci-github.ts,
// Batch 12.7).
export const ACTIFS_CONNUS: readonly SecurityAssetReference[] = [
  { type: "APPLICATION", identifiant: "atlas-admin-demo" },
  { type: "SERVICE", identifiant: "GitHub Actions (BharKhouloud16/atlas-admin-demo)" },
];

// POINTS D'ENTRÉE CONNUS — registre statique. Volontairement restreint au
// seul point d'entrée Security/Quality construit à ce jour ; l'inventaire
// exhaustif de TOUTES les routes ATLAS (app/api/**) serait un scanner de
// fait, hors périmètre de ce lot (voir note de tête de fichier).
export const POINTS_ENTREE_CONNUS: readonly SecurityEntryPoint[] = [
  {
    reference: { type: "ENDPOINT", identifiant: "GET /api/quality" },
    methode: "GET",
    rbac: "ADMIN",
    fichier: "app/api/quality/route.ts",
  },
];

// CONTRÔLES CONNUS — registre statique des mécanismes de sécurité déjà
// vérifiés par lecture directe du code (B13.0 à B13.3). Chaque entrée est
// un FAIT ("ce mécanisme existe, voir ce fichier"), jamais un jugement de
// suffisance — l'évaluation de suffisance appartient à une future analyse
// (Finding, Batch 13.6), pas à ce registre.
export const CONTROLES_CONNUS: readonly SecurityControl[] = [
  {
    id: "rbac-session-jwt",
    label: "Session JWT signée avec vérification de rôle serveur",
    domaine: "AUTHENTICATION",
    description: "Cookie de session httpOnly (JWT signé HS256) ; le rôle est relu depuis le token vérifié côté serveur, jamais fait confiance au client.",
    fichier: "lib/auth.ts",
  },
  {
    id: "quality-api-admin-only",
    label: "GET /api/quality réservé à l'Administrateur",
    domaine: "AUTHORIZATION",
    description: "session.role !== \"ADMIN\" retourne 403 avant tout traitement ; aucune donnée n'est calculée pour un rôle non autorisé.",
    fichier: "app/api/quality/route.ts",
  },
  {
    id: "ci-source-timeout",
    label: "Délai d'attente obligatoire sur la source CI externe",
    domaine: "API_SECURITY",
    description: "AbortController avec délai de 8000ms sur l'appel réseau à l'API GitHub Actions ; un dépassement est traité comme une panne réseau.",
    fichier: "lib/quality/sources/ci-github.ts",
  },
  {
    id: "ci-source-validation-stricte",
    label: "Validation stricte du JSON externe (GitHub Actions)",
    domaine: "INPUT_VALIDATION",
    description: "Chaque run reçu est validé champ par champ (runEstExploitable) avant traduction ; un run malformé est rejeté individuellement, jamais toute la réponse.",
    fichier: "lib/quality/sources/ci-github.ts",
  },
  {
    id: "session-cookie-httponly",
    label: "Cookie de session HttpOnly, SameSite=Lax",
    domaine: "SESSION_SECURITY",
    description: "cookies().set(..., { httpOnly: true, secure: proto === \"https\", sameSite: \"lax\" }) — jamais accessible en JavaScript côté client.",
    fichier: "lib/auth.ts",
  },
  {
    id: "secret-detection-security-evidence",
    label: "Détection de motif de secret avant construction d'une observation Security",
    domaine: "SECRETS",
    description: "Toute entrée dont un champ ressemble à un secret (jeton GitHub, clé privée PEM, en-tête Bearer, affectation password:/token:/api_key:) est rejetée entièrement.",
    fichier: "lib/security/evidence.ts",
  },
] as const;

// Recherche pure — retourne null si absent, jamais une exception (même
// convention que le reste de lib/security/).
export function trouverActif(identifiant: string): SecurityAssetReference | null {
  return ACTIFS_CONNUS.find((a) => a.identifiant === identifiant) ?? null;
}

export function trouverPointEntree(identifiant: string): SecurityEntryPoint | null {
  return POINTS_ENTREE_CONNUS.find((p) => p.reference.identifiant === identifiant) ?? null;
}

export function trouverControle(id: string): SecurityControl | null {
  return CONTROLES_CONNUS.find((c) => c.id === id) ?? null;
}

// Garde-fous structurels purs — même discipline que lib/security/domain.ts.
export function estPointEntreeValide(point: SecurityEntryPoint): boolean {
  return (
    estSecurityAssetTypeValide(point.reference.type) &&
    point.reference.identifiant.trim().length > 0 &&
    point.methode.trim().length > 0 &&
    point.fichier.trim().length > 0
  );
}

export function estControleValide(controle: SecurityControl): boolean {
  return (
    estSecurityDomaineValide(controle.domaine) &&
    controle.id.trim().length > 0 &&
    controle.label.trim().length > 0 &&
    controle.description.trim().length > 0 &&
    controle.fichier.trim().length > 0
  );
}

// Construit une SecurityObservation à partir d'un contrôle CONNU (registre
// ci-dessus) — jamais depuis un contrôle arbitraire non enregistré. Le
// statut reste à la charge de l'appelant (ce module ne décide jamais lui-
// même si un contrôle est PASS/FAIL : ce serait fabriquer un verdict sans
// nouvelle preuve — voir directive B13 section 5). `source` par défaut
// "CODE_REVIEW" (constat de lecture directe du code, voir QualitySource,
// lib/quality/domain.ts) — override possible si l'observation vient d'une
// autre source réelle (ex. "CI" si un futur test automatisé la confirme).
export function construireObservationDepuisControle(
  controleId: string,
  statut: QualityStatus,
  horodatage: Date,
  options?: { source?: QualitySource; preuveComplementaire?: string }
): SecurityObservation | null {
  const controle = trouverControle(controleId);
  if (!controle) return null;

  const preuveBase = `${controle.description} (voir ${controle.fichier})`;
  const preuve = options?.preuveComplementaire ? `${preuveBase} — ${options.preuveComplementaire}` : preuveBase;

  return construireObservationSecurite({
    statut,
    label: controle.label,
    preuve,
    source: options?.source ?? "CODE_REVIEW",
    horodatage,
    securityDomaine: controle.domaine,
    contexte: controle.fichier,
    provenanceDetail: null,
    actif: null,
  });
}
