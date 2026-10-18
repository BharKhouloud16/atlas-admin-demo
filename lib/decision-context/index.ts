import type { DecisionContext, DecisionType } from "./context";
import { construireDecisionContext, DecisionEntityIntrouvableError } from "./context";
import type { DecisionLearning } from "./retrieval";
import { rechercherLearningsPertinents } from "./retrieval";
import type { DecisionConflict } from "./conflicts";
import { detecterConflitsDecision } from "./conflicts";

export { DecisionEntityIntrouvableError };
export type { DecisionType, DecisionContext, DecisionLearning, DecisionConflict };

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Orchestrateur PUR (contrat A36 §17, A36.1 §2) : Decision Entity ->
// DecisionContext -> Learnings VALIDE+ACTIVE pertinents -> statut. Aucune
// écriture, aucune décision métier, aucun appel IA — ce module reste un
// CONSOMMATEUR du Learning Contract (A30), jamais une autorité. RBAC sur
// decisionEntityId : responsabilité de l'appelant (voir context.ts).

export type DecisionContextStatus = "RELEVANT_CONTEXT" | "NO_RELEVANT_LEARNING" | "CONFLICTING_CONTEXT";

export type DecisionContextResultat = {
  decisionType: DecisionType;
  decisionEntityId: string;
  context: DecisionContext;
  learnings: DecisionLearning[];
  conflicts: DecisionConflict[];
  status: DecisionContextStatus;
};

// Exportée pour test unitaire direct (même méthodologie que
// determinerType()/determinerConfidence(), A35) — la logique de statut
// est pure et ne doit pas dépendre de la pureté empirique de la base
// (ATLAS étant global par construction, un environnement réel ou de test
// partagé ne peut jamais garantir l'absence de tout Learning ATLAS
// VALIDE+ACTIVE pour vérifier NO_RELEVANT_LEARNING autrement).
export function determinerStatus(learnings: DecisionLearning[], conflicts: DecisionConflict[]): DecisionContextStatus {
  if (learnings.length === 0) return "NO_RELEVANT_LEARNING";
  if (conflicts.length > 0) return "CONFLICTING_CONTEXT";
  return "RELEVANT_CONTEXT";
}

export async function construireContexteDecisionnel(decisionType: DecisionType, decisionEntityId: string): Promise<DecisionContextResultat> {
  const context = await construireDecisionContext(decisionType, decisionEntityId);
  const learnings = await rechercherLearningsPertinents(context);
  const conflicts = detecterConflitsDecision(learnings);
  return {
    decisionType,
    decisionEntityId,
    context,
    learnings,
    conflicts,
    status: determinerStatus(learnings, conflicts),
  };
}
