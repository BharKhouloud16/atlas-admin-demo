// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.5, 07/09/2026).
// SECURITY ANALYSIS V1 : assemble Observation + Evidence + Signal + Asset +
// Control (déjà construits par B13.1-B13.4) en une vue structurée, par
// domaine et par actif — directive B13, section 16 (B13.5) : "assembler
// Observation+Evidence+Signal+Asset+Control pour analyse structurée. Pas de
// score global, pas de conclusion artificielle."
//
// RÈGLES ABSOLUES (héritées de B12.4 Dimensions, reconduites à l'identique) :
// - ZÉRO score, zéro verdict, zéro priorisation entre domaines ou actifs. Ce
//   module ne fait QUE partitionner/assembler des données déjà construites
//   ailleurs — il n'invente, ne filtre ni ne masque aucune observation ou
//   signal. Toute notion de verdict humainement défini reste hors périmètre
//   de ce lot (voir Finding, Batch 13.6, à venir).
// - Les 13 domaines Security (lib/security/domain.ts) sont TOUJOURS tous
//   présents dans le résultat par domaine, même sans aucune observation —
//   même principe que construireTousLesDimensionSnapshots (B12.4).
// - Le regroupement par actif ne fait QUE relire le champ `actif` déjà posé
//   sur chaque SecurityObservation (B13.2/13.3, jamais recalculé ni déduit
//   ici) — un actif jamais cité par aucune observation apparaît quand même
//   (groupe vide), une observation sans actif associé va dans le groupe
//   NON_ASSOCIE plutôt que d'être supprimée ou rattachée arbitrairement.
// - Les registres CONTROLES_CONNUS/POINTS_ENTREE_CONNUS/ACTIFS_CONNUS
//   (B13.4) sont cités tels quels, jamais dupliqués ni recalculés.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12.
// - Pas de DB, pas de LLM : fonctions pures et déterministes sur des
//   tableaux déjà construits ailleurs.

import type { QualityStatus } from "@/lib/quality/domain";
import type { SignalType } from "@/lib/quality/signals";
import { SECURITY_DOMAINS, type SecurityAssetReference, type SecurityDomain } from "./domain";
import type { SecurityObservation } from "./evidence";
import type { SecuritySignal } from "./signals";
import {
  ACTIFS_CONNUS,
  CONTROLES_CONNUS,
  POINTS_ENTREE_CONNUS,
  type SecurityControl,
  type SecurityEntryPoint,
} from "./assets";

// Vue d'ensemble d'UN domaine Security — regroupe les observations par
// statut et les signaux par type (même structure que DimensionSnapshot,
// lib/quality/dimensions.ts, Batch 12.4), enrichie des contrôles connus
// (registre statique B13.4) relevant de ce domaine.
export type SecurityDomainSnapshot = {
  domaine: SecurityDomain;
  observations: SecurityObservation[];
  signaux: SecuritySignal[];
  observationsParStatut: Record<QualityStatus, SecurityObservation[]>;
  signauxParType: Partial<Record<SignalType, SecuritySignal[]>>;
  controlesDuDomaine: SecurityControl[];
};

// Regroupement des observations/signaux par actif — relit uniquement le
// champ `actif` déjà posé sur chaque SecurityObservation, ne déduit ni ne
// devine aucune association. `actif: null` regroupe les observations sans
// actif associé (le champ `actif` de SecurityObservation est optionnel
// depuis B13.2).
export type SecurityAssetGroup = {
  actif: SecurityAssetReference | null;
  observations: SecurityObservation[];
  signaux: SecuritySignal[];
};

// Assemblage complet — pas de score, pas de conclusion, uniquement des
// données déjà construites, organisées pour la lecture humaine.
export type SecurityAnalysis = {
  parDomaine: Record<SecurityDomain, SecurityDomainSnapshot>;
  parActif: SecurityAssetGroup[];
  actifsConnus: readonly SecurityAssetReference[];
  pointsEntreeConnus: readonly SecurityEntryPoint[];
  controlesConnus: readonly SecurityControl[];
};

function observationsVidesParStatut(): Record<QualityStatus, SecurityObservation[]> {
  return {
    UNKNOWN: [],
    NOT_EVALUATED: [],
    OBSERVED: [],
    PASS: [],
    WARNING: [],
    FAIL: [],
    BLOCKED: [],
    NOT_APPLICABLE: [],
  };
}

// Construit l'instantané d'UN domaine Security à partir de tableaux déjà
// construits — fonction pure, ne mute jamais ses entrées.
export function construireSecurityDomainSnapshot(
  domaine: SecurityDomain,
  observations: SecurityObservation[],
  signaux: SecuritySignal[]
): SecurityDomainSnapshot {
  const observationsDuDomaine = observations.filter((o) => o.securityDomaine === domaine);
  const signauxDuDomaine = signaux.filter((s) => s.securityDomaine === domaine);

  const observationsParStatut = observationsVidesParStatut();
  for (const o of observationsDuDomaine) {
    observationsParStatut[o.statut].push(o);
  }

  const signauxParType: Partial<Record<SignalType, SecuritySignal[]>> = {};
  for (const s of signauxDuDomaine) {
    const liste = signauxParType[s.type] ?? [];
    liste.push(s);
    signauxParType[s.type] = liste;
  }

  const controlesDuDomaine = CONTROLES_CONNUS.filter((c) => c.domaine === domaine);

  return {
    domaine,
    observations: observationsDuDomaine,
    signaux: signauxDuDomaine,
    observationsParStatut,
    signauxParType,
    controlesDuDomaine,
  };
}

// Construit les 13 instantanés (un par domaine, toujours) — jamais un
// domaine absent, même sans aucune observation ni signal.
export function construireTousLesSecurityDomainSnapshots(
  observations: SecurityObservation[],
  signaux: SecuritySignal[]
): Record<SecurityDomain, SecurityDomainSnapshot> {
  const resultat = {} as Record<SecurityDomain, SecurityDomainSnapshot>;
  for (const domaine of SECURITY_DOMAINS) {
    resultat[domaine] = construireSecurityDomainSnapshot(domaine, observations, signaux);
  }
  return resultat;
}

function memeActif(a: SecurityAssetReference | null, b: SecurityAssetReference | null): boolean {
  if (a === null || b === null) return a === b;
  return a.type === b.type && a.identifiant === b.identifiant;
}

// Regroupe observations et signaux par actif — un groupe par actif du
// registre ACTIFS_CONNUS (toujours présent, même vide), plus un groupe
// NON_ASSOCIE (`actif: null`) pour les observations sans actif renseigné.
// N'invente aucun lien : relit exactement le champ `actif` déjà posé lors
// de la construction de chaque observation (B13.2).
export function grouperParActif(observations: SecurityObservation[], signaux: SecuritySignal[]): SecurityAssetGroup[] {
  const references: (SecurityAssetReference | null)[] = [...ACTIFS_CONNUS, null];

  // Un actif cité par une observation mais absent du registre connu reste
  // visible (jamais silencieusement ignoré) — ajouté à la liste des
  // références à regrouper, sans être ajouté au registre lui-même.
  for (const o of observations) {
    if (o.actif && !references.some((r) => memeActif(r, o.actif))) {
      references.push(o.actif);
    }
  }

  return references.map((actif) => ({
    actif,
    observations: observations.filter((o) => memeActif(o.actif ?? null, actif)),
    signaux: signaux.filter((s) => memeActif(s.actif ?? null, actif)),
  }));
}

// Point d'entrée principal du lot : assemble Observation + Evidence (déjà
// incluse dans SecurityObservation) + Signal + Asset + Control en une seule
// structure, sans score ni conclusion. Fonction pure et déterministe.
export function construireSecurityAnalysis(observations: SecurityObservation[], signaux: SecuritySignal[]): SecurityAnalysis {
  return {
    parDomaine: construireTousLesSecurityDomainSnapshots(observations, signaux),
    parActif: grouperParActif(observations, signaux),
    actifsConnus: ACTIFS_CONNUS,
    pointsEntreeConnus: POINTS_ENTREE_CONNUS,
    controlesConnus: CONTROLES_CONNUS,
  };
}
