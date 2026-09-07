// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.2, 07/09/2026).
// Couche EVIDENCE Security : ADAPTE la couche Evidence de B12
// (lib/quality/evidence.ts) au domaine Security — ne la remplace pas, ne
// la duplique pas (directive B13, section 3 : "NE PAS créer un deuxième
// système d'evidence").
//
// Une SecurityObservation EST une QualityObservation avec
// `dimension: "SECURITY"` (voir lib/security/domain.ts), enrichie de deux
// champs que B12 ne pouvait pas exprimer : `securityDomaine` (lequel des
// treize domaines de sécurité, voir lib/security/domain.ts) et `actif`
// (référence optionnelle vers l'actif concerné, uniquement lorsque
// réellement observable — jamais inventé, voir directive B13 section 6).
// Toute la validation structurelle de base (label/preuve non vides,
// vocabulaire fermé) reste celle de B12 (`estObservationValide`) — ce
// module ne la réimplémente jamais en parallèle, il l'appelle.
//
// RÈGLE ABSOLUE SUPPLÉMENTAIRE (directive B13, section 7) : "Aucune donnée
// sensible inutile. Ne jamais stocker : mots de passe, tokens, secrets,
// clés privées, credentials, données personnelles inutiles. Les secrets
// doivent être détectés comme présence/type si nécessaire, jamais copiés
// dans les résultats." — `construireObservationSecurite` applique cette
// règle en amont : toute entrée dont le texte (label/preuve/contexte/
// provenanceDetail) contient un motif ressemblant à un secret est REJETÉE
// (jamais nettoyée silencieusement, jamais stockée partiellement) — même
// discipline de rejet que `estObservationValide` (B12.1) pour une preuve
// vide : mieux vaut l'absence d'observation qu'une observation qui fuite.

import {
  estObservationValide,
  type QualityObservation,
  type QualitySource,
  type QualityStatus,
} from "@/lib/quality/domain";
import {
  estSecurityAssetReferenceValide,
  estSecurityDomaineValide,
  SECURITY_DOMAINS,
  type SecurityAssetReference,
  type SecurityDomain,
} from "./domain";

export type SecurityObservation = QualityObservation & {
  dimension: "SECURITY";
  securityDomaine: SecurityDomain;
  actif: SecurityAssetReference | null;
};

export type EntreeObservationSecurite = {
  statut: QualityStatus;
  label: string;
  preuve: string;
  source: QualitySource;
  horodatage: Date;
  securityDomaine: SecurityDomain;
  contexte?: string | null;
  provenanceDetail?: string | null;
  actif?: SecurityAssetReference | null;
};

// Motifs de détection de secret — VOLONTAIREMENT larges et prudents : un
// faux positif (texte légitime rejeté) est toujours préférable à un faux
// négatif (un secret qui fuite dans une observation stockée). Cette
// détection sert UNIQUEMENT à décider si une entrée doit être rejetée —
// elle n'extrait, ne journalise ni ne réexpose jamais la valeur détectée.
const MOTIFS_SECRET: readonly RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/, // jeton d'accès personnel GitHub
  /github_pat_[A-Za-z0-9_]{20,}/, // jeton d'accès affiné GitHub
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // clé privée PEM
  /AKIA[0-9A-Z]{16}/, // identifiant de clé d'accès AWS
  /\bBearer\s+[A-Za-z0-9._-]{10,}/i, // en-tête d'autorisation Bearer
  /\b(mot de passe|password|passwd|secret|api[_-]?key|clé api|token)\s*[:=]\s*\S+/i, // affectation explicite clé:valeur
];

// Vérifie qu'un texte ne contient aucun motif ressemblant à un secret —
// fonction pure, ne lève jamais d'exception, ne journalise jamais le texte
// examiné (appelant : voir `construireObservationSecurite`).
export function contientMotifSecretSuspect(texte: string): boolean {
  return MOTIFS_SECRET.some((motif) => motif.test(texte));
}

function texteSuspect(entree: EntreeObservationSecurite): boolean {
  const champs = [entree.label, entree.preuve, entree.contexte ?? "", entree.provenanceDetail ?? ""];
  return champs.some((c) => contientMotifSecretSuspect(c));
}

// Fabrique pure et déterministe — adapte construireObservation (B12.2) au
// domaine Security. Rejette (retourne null, jamais une exception) si :
// - la base QualityObservation n'est pas valide (label/preuve vides,
//   vocabulaire hors liste fermée — voir estObservationValide, B12.1) ;
// - `securityDomaine` n'appartient pas au vocabulaire fermé SecurityDomain ;
// - `actif`, s'il est fourni, n'est pas une référence valide (voir
//   estSecurityAssetReferenceValide, B13.1) ;
// - un texte quelconque de l'entrée ressemble à un secret (voir
//   `texteSuspect` ci-dessus) — jamais un nettoyage silencieux, toujours un
//   rejet complet de l'observation.
export function construireObservationSecurite(entree: EntreeObservationSecurite): SecurityObservation | null {
  if (!estSecurityDomaineValide(entree.securityDomaine)) return null;
  if (entree.actif != null && !estSecurityAssetReferenceValide(entree.actif)) return null;
  if (texteSuspect(entree)) return null;

  const observation: SecurityObservation = {
    dimension: "SECURITY",
    statut: entree.statut,
    label: entree.label.trim(),
    preuve: entree.preuve.trim(),
    source: entree.source,
    horodatage: entree.horodatage,
    contexte: entree.contexte?.trim() || null,
    provenanceDetail: entree.provenanceDetail?.trim() || null,
    securityDomaine: entree.securityDomaine,
    actif: entree.actif ?? null,
  };

  return estObservationValide(observation) ? observation : null;
}

// Construit plusieurs observations Security en une fois, en écartant
// silencieusement (jamais un crash) les entrées invalides ou suspectes —
// retourne aussi le nombre d'entrées écartées, jamais masqué (même
// convention que construireObservations, lib/quality/evidence.ts B12.2).
export function construireObservationsSecurite(entrees: EntreeObservationSecurite[]): {
  observations: SecurityObservation[];
  rejetees: number;
} {
  const observations: SecurityObservation[] = [];
  let rejetees = 0;
  for (const entree of entrees) {
    const o = construireObservationSecurite(entree);
    if (o) observations.push(o);
    else rejetees++;
  }
  return { observations, rejetees };
}

// Partition PURE par domaine de sécurité — jamais un résumé ni un verdict
// par domaine (voir Batch 12.4/Dimensions pour l'équivalent Quality). Les
// treize domaines sont toujours présents dans le résultat, même vides —
// jamais un domaine silencieusement absent (même principe que
// grouperParDimension, lib/quality/evidence.ts).
export function grouperParDomaineSecurite(observations: SecurityObservation[]): Record<SecurityDomain, SecurityObservation[]> {
  const groupes = Object.fromEntries(SECURITY_DOMAINS.map((d) => [d, [] as SecurityObservation[]])) as Record<
    SecurityDomain,
    SecurityObservation[]
  >;
  for (const o of observations) {
    groupes[o.securityDomaine].push(o);
  }
  return groupes;
}

// Filtre PUR par statut — utilitaire de lecture, aucune interprétation
// ajoutée (même principe que filtrerParStatut, lib/quality/evidence.ts).
export function filtrerParStatutSecurite(observations: SecurityObservation[], statuts: QualityStatus[]): SecurityObservation[] {
  const ensemble = new Set(statuts);
  return observations.filter((o) => ensemble.has(o.statut));
}

// Tri PUR par horodatage, du plus récent au plus ancien — ne modifie pas
// le tableau d'entrée (retourne une copie), même convention que
// trierParRecence (lib/quality/evidence.ts).
export function trierParRecenceSecurite(observations: SecurityObservation[]): SecurityObservation[] {
  return [...observations].sort((a, b) => b.horodatage.getTime() - a.horodatage.getTime());
}
