import type { DecisionLearning } from "./retrieval";

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Détection de conflit DÉTERMINISTE (contrat A36 §9/A36.1 §14-§15) —
// réutilise le PRINCIPE déjà validé par F5 (lib/learning-loop/
// contradictions.ts, A35, inchangé par ce lot) : BEST_PRACTICE vs
// ANTI_PATTERN est un SIGNAL, jamais un arbitrage. La fonction opère ICI
// sur l'ensemble DÉJÀ pertinent pour UN SEUL DecisionContext (sortie de
// rechercherLearningsPertinents) — contrairement à F5 (qui recherche une
// contradiction Learning-à-Learning sur un chevauchement lexical de
// titre, à travers toute la base), ici l'univers est déjà restreint au
// même contexte décisionnel précis : aucun recoupement lexical
// supplémentaire n'est nécessaire ni ajouté (une Capability/Client/
// Mission partagée constitue déjà une correspondance plus précise qu'un
// simple chevauchement de mots). lib/learning-loop/contradictions.ts
// n'est ni modifié ni appelé depuis ce fichier (contrat A36.1 §14, "ne
// pas modifier contradictions.ts si ce n'est pas nécessaire").
//
// INTERDIT (contrat A36.1 §15) : choisir un gagnant, préférer HIGH
// confidence, préférer le plus récent, préférer BEST_PRACTICE par
// défaut. Les deux Learnings restent TOUJOURS dans `learnings[]` — ce
// module ne fait qu'AJOUTER un signal `conflicts[]`, jamais retirer ou
// réordonner quoi que ce soit.

export type DecisionConflict = {
  learningAId: string;
  learningBId: string;
  type: "BEST_PRACTICE_VS_ANTI_PATTERN";
};

export function detecterConflitsDecision(learnings: DecisionLearning[]): DecisionConflict[] {
  const bestPractices = learnings.filter((l) => l.type === "BEST_PRACTICE");
  const antiPatterns = learnings.filter((l) => l.type === "ANTI_PATTERN");

  const conflicts: DecisionConflict[] = [];
  for (const a of bestPractices) {
    for (const b of antiPatterns) {
      conflicts.push({ learningAId: a.learningId, learningBId: b.learningId, type: "BEST_PRACTICE_VS_ANTI_PATTERN" });
    }
  }
  return conflicts;
}
