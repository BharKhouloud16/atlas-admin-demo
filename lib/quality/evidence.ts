// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.2, 07/09/2026). Couche
// EVIDENCE : construit et organise des QualityObservation (lib/quality/domain.ts)
// à partir de faits déjà connus — jamais une nouvelle collecte de données,
// jamais un calcul de score. Ce lot reste strictement au niveau EVIDENCE de
// l'architecture ATLAS (DATA -> EVIDENCE -> CONFIDENCE -> TRUST ->
// INTELLIGENCE -> RECOMMENDATION -> HUMAN DECISION -> AUDIT) : aucune
// agrégation en un niveau global (voir Batch 12.4/12.5, Dimensions/Gates,
// pour ça, explicitement, plus tard).
//
// RÈGLE ABSOLUE (héritée de Batch 12.1) : une observation invalide
// (preuve/label vide, vocabulaire hors liste fermée) n'est jamais corrigée
// silencieusement ni fabriquée — elle est REJETÉE (retour null), jamais une
// exception qui ferait planter l'appelant (voir estObservationValide,
// lib/quality/domain.ts, "jamais un crash serveur pour une donnée de
// qualité manquante").

import {
  estObservationValide,
  QUALITY_DIMENSIONS,
  type QualityDimension,
  type QualityObservation,
  type QualitySource,
  type QualityStatus,
} from "./domain";

export type EntreeObservation = {
  dimension: QualityDimension;
  statut: QualityStatus;
  label: string;
  preuve: string;
  source: QualitySource;
  horodatage: Date;
  contexte?: string | null;
  provenanceDetail?: string | null;
};

// Fabrique pure et déterministe — normalise (trim des chaînes) puis valide
// via estObservationValide (jamais une deuxième règle de validation
// parallèle). Retourne null sur une entrée invalide plutôt que de lever une
// exception ou de fabriquer une valeur de repli : c'est à l'appelant de
// décider quoi faire d'une entrée rejetée (ex. la journaliser ailleurs),
// jamais à ce module de deviner.
export function construireObservation(entree: EntreeObservation): QualityObservation | null {
  const observation: QualityObservation = {
    dimension: entree.dimension,
    statut: entree.statut,
    label: entree.label.trim(),
    preuve: entree.preuve.trim(),
    source: entree.source,
    horodatage: entree.horodatage,
    contexte: entree.contexte?.trim() || null,
    provenanceDetail: entree.provenanceDetail?.trim() || null,
  };
  return estObservationValide(observation) ? observation : null;
}

// Construit plusieurs observations en une fois, en écartant silencieusement
// (jamais un crash) les entrées invalides — retourne aussi le nombre
// d'entrées écartées pour que l'appelant puisse le signaler s'il le souhaite
// (jamais masqué).
export function construireObservations(entrees: EntreeObservation[]): { observations: QualityObservation[]; rejetees: number } {
  const observations: QualityObservation[] = [];
  let rejetees = 0;
  for (const entree of entrees) {
    const o = construireObservation(entree);
    if (o) observations.push(o);
    else rejetees++;
  }
  return { observations, rejetees };
}

// Partition PURE par dimension — jamais un résumé ni un verdict par
// dimension (voir Batch 12.4 pour ça). Toutes les huit dimensions sont
// toujours présentes dans le résultat, même vides — jamais une dimension
// silencieusement absente parce qu'aucune observation ne la concerne
// encore.
export function grouperParDimension(observations: QualityObservation[]): Record<QualityDimension, QualityObservation[]> {
  const groupes = Object.fromEntries(QUALITY_DIMENSIONS.map((d) => [d, [] as QualityObservation[]])) as Record<
    QualityDimension,
    QualityObservation[]
  >;
  for (const o of observations) {
    groupes[o.dimension].push(o);
  }
  return groupes;
}

// Filtre PUR par statut — utilitaire de lecture, aucune interprétation
// ajoutée (ex. lister tous les FAIL pour une revue humaine).
export function filtrerParStatut(observations: QualityObservation[], statuts: QualityStatus[]): QualityObservation[] {
  const ensemble = new Set(statuts);
  return observations.filter((o) => ensemble.has(o.statut));
}

// Filtre PUR par source — utilitaire de lecture (ex. ne garder que les
// observations issues de la CI, jamais mélangées silencieusement avec des
// déclarations non vérifiées dans un contexte qui exige une preuve
// indépendante).
export function filtrerParSource(observations: QualityObservation[], sources: QualitySource[]): QualityObservation[] {
  const ensemble = new Set(sources);
  return observations.filter((o) => ensemble.has(o.source));
}

// Tri PUR par horodatage, du plus récent au plus ancien — ne modifie pas le
// tableau d'entrée (retourne une copie), jamais un tri en place qui
// surprendrait l'appelant.
export function trierParRecence(observations: QualityObservation[]): QualityObservation[] {
  return [...observations].sort((a, b) => b.horodatage.getTime() - a.horodatage.getTime());
}
