import type { DecisionContext } from "./context";

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Classification DÉTERMINISTE de pertinence (contrat A36 §7, A36.1 §9-§11)
// — DEUX niveaux seulement en V1 ("WEAK" explicitement retiré par décision
// d'implémentation A36.1 §9 : provenance/confidence/type restent des
// propriétés PROPRES au Learning, jamais mélangées dans le calcul de
// pertinence CONTEXTUELLE). AUCUN score numérique, AUCUN coefficient,
// AUCUN ranking opaque — uniquement une correspondance structurelle
// explicite entre `scope` et le DecisionContext.
//
// DOMAIN (contrat A36.1 — décision CTO) : EXCLU structurellement — AUCUNE
// dimension Domain n'existe dans le schéma ATLAS aujourd'hui (confirmé A35
// F4, "Domain n'existe comme champ nulle part dans le schéma ATLAS") ;
// l'assimiler à ATLAS ou à un contexte artificiel serait inventer une
// correspondance non fondée sur une donnée réelle. Retourne `null` (jamais
// récupéré par rechercherLearningsPertinents) tant qu'aucune dimension
// Domain structurée n'existe.

export type LearningRelevance = "DIRECT" | "CONTEXTUAL";

export type RelevanceResolue = { relevance: LearningRelevance; reason: string };

// Sous-ensemble minimal du Learning nécessaire à la classification — la
// Capability ACTIVE de la Mission source est déjà résolue par l'appelant
// (retrieval.ts), jamais recalculée différemment ici.
export type LearningPourRelevance = {
  scope: "MISSION" | "CLIENT" | "DOMAIN" | "CAPABILITY" | "ATLAS";
  missionId: string;
  missionClientId: string;
  missionCapabilitesActives: string[];
};

export function determinerRelevance(learning: LearningPourRelevance, context: DecisionContext): RelevanceResolue | null {
  switch (learning.scope) {
    case "DOMAIN":
      // Limitation documentée (contrat A36.1 §19) : DOMAIN scope exists in
      // A30 but is not structurally retrievable until ATLAS introduces a
      // domain anchor. Jamais assimilé à ATLAS, jamais transformé.
      return null;

    case "MISSION":
      // Éligible UNIQUEMENT si le DecisionContext porte lui-même un
      // missionId (NEED/QUALIFICATION/SOLUTION n'en portent jamais un —
      // contrat A36.1 §8) ET que c'est EXACTEMENT la même Mission.
      if (context.missionId && learning.missionId === context.missionId) {
        return { relevance: "DIRECT", reason: "Learning from the same Mission." };
      }
      return null;

    case "CLIENT":
      // Le Client du Learning (via sa Mission source) doit être
      // EXACTEMENT celui du DecisionContext — jamais une correspondance
      // partielle, jamais un fallback.
      if (learning.missionClientId === context.clientId) {
        return { relevance: "DIRECT", reason: "Learning declared at Client scope for the same Client." };
      }
      return null;

    case "CAPABILITY": {
      // Intersection non vide entre les Capability ACTIVE de la Mission
      // source du Learning et celles, réellement dérivées (A8) ou liées
      // (A21), du DecisionContext — jamais une capacité inventée (contrat
      // A36.1 §5, "les Capability doivent provenir exclusivement des
      // données structurées existantes").
      const partagee = learning.missionCapabilitesActives.some((c) => context.capabilityIds.includes(c));
      if (partagee) {
        return { relevance: "CONTEXTUAL", reason: "Learning associated with a shared active Capability." };
      }
      return null;
    }

    case "ATLAS":
      // Global au système, mais JAMAIS "DIRECT" (contrat A36.1 §10 : "Ne
      // pas déclarer automatiquement un Learning ATLAS comme DIRECT") et
      // JAMAIS une vérité/priorité absolue (contrat A36.1 §8 : "ATLAS ≠
      // vérité, ATLAS ≠ priorité absolue, ATLAS ≠ règle").
      return { relevance: "CONTEXTUAL", reason: "Atlas-wide validated Learning." };
  }
}
