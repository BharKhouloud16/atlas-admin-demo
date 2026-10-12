import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Construit un DecisionContext RUNTIME-ONLY (contrat A36 §5/§10, décision
// CTO) — jamais persisté, jamais une nouvelle table : entièrement
// reconstructible depuis les identifiants déjà existants (Mission/
// ClientNeed/SolutionOption, A18/A8/C3). "Learning = evidence/context,
// jamais policy" : ce module ne fait QUE résoudre un contexte, il ne
// décide jamais rien lui-même.
//
// RBAC : ce module reste, comme lib/learning/learning.ts (A30) et
// lib/learning-loop/*.ts (A34/A35), ENTIÈREMENT AGNOSTIQUE de
// session.role — aucune vérification de rôle n'est faite ici (contrat
// A36.1 §21, "ne pas créer un nouveau système d'autorisation parallèle").
// L'AUTORISATION D'ACCÉDER À decisionEntityId (ex. un INGENIEUR autorisé
// sur cette Mission via lib/delivery-evidence/access.ts::
// estIngenieurAutoriseSurMission) reste ENTIÈREMENT la responsabilité de
// l'appelant, AVANT d'invoquer construireDecisionContext() — exactement
// la même discipline que tous les services lib/* existants (A26/A27/A29/
// A30). Ce module ne protège qu'UNE chose : qu'un contexte résolu ne
// puisse jamais, par construction, mélanger les données de deux Clients
// (clientId/capabilityIds proviennent toujours de l'entité réelle en
// base, jamais d'une entrée utilisateur non vérifiée).

export class DecisionEntityIntrouvableError extends Error {
  constructor(public readonly decisionType: DecisionType) {
    super("DECISION_ENTITY_INTROUVABLE");
  }
}

export type DecisionType = "NEED" | "QUALIFICATION" | "SOLUTION" | "MISSION";

export type DecisionContext = {
  decisionType: DecisionType;
  decisionEntityId: string;
  clientId: string;
  // Jamais inventées : uniquement des CapabilityRequirement(status=ACTIVE)
  // réellement dérivées (A8) pour NEED/QUALIFICATION/SOLUTION, ou des
  // MissionCapabilityLink(statut=ACTIVE) réels (A21) pour MISSION.
  capabilityIds: string[];
  missionId?: string;
  needVersionId?: string;
  // A36.2.2-FIX (contrat A36.2.1) : signifie EXCLUSIVEMENT "identifiant
  // d'une vraie décision Solution" (SolutionOption.niveau === "DECISION")
  // — jamais l'id d'une simple RECOMMANDATION/OPTION/HYPOTHESE consultée.
  // `decisionEntityId` reste la référence canonique de l'entité
  // effectivement consultée, quel que soit son niveau ; ce champ-ci ne
  // fait qu'exposer, en plus, le fait qu'une décision réelle existe (ou
  // non) — jamais un second nom pour la même chose.
  solutionDecisionId?: string;
};

async function capabilitesActivesDuNeed(needVersionId: string): Promise<string[]> {
  const liens = await prisma.capabilityRequirement.findMany({
    where: { needVersionId, status: "ACTIVE" },
    select: { requiredCapability: true },
  });
  return [...new Set(liens.map((l) => l.requiredCapability))];
}

// COMPANY ATLAS — A36.1 : résolution du DecisionContext par decisionType.
//
// QUALIFICATION n'est jamais une entité séparée (contrat A36 §2/A36.1 §5,
// "la qualification n'est PAS une nouvelle entité") — elle réutilise
// EXACTEMENT la même résolution que NEED (ClientNeed). Volontairement
// fusionnées dans le même embranchement de code ci-dessous plutôt que
// dupliquées, puisqu'il s'agit littéralement de la même entité et de la
// même requête — une duplication introduirait un risque de divergence
// sans aucun bénéfice.
export async function construireDecisionContext(decisionType: DecisionType, decisionEntityId: string): Promise<DecisionContext> {
  switch (decisionType) {
    case "NEED":
    case "QUALIFICATION": {
      const need = await prisma.clientNeed.findUnique({ where: { id: decisionEntityId }, select: { id: true, clientId: true } });
      if (!need) throw new DecisionEntityIntrouvableError(decisionType);
      return {
        decisionType,
        decisionEntityId,
        clientId: need.clientId,
        capabilityIds: await capabilitesActivesDuNeed(need.id),
        needVersionId: need.id,
      };
    }
    case "SOLUTION": {
      const option = await prisma.solutionOption.findUnique({ where: { id: decisionEntityId }, select: { id: true, clientId: true, needId: true, niveau: true } });
      if (!option) throw new DecisionEntityIntrouvableError(decisionType);
      return {
        decisionType,
        decisionEntityId,
        clientId: option.clientId,
        capabilityIds: await capabilitesActivesDuNeed(option.needId),
        needVersionId: option.needId,
        // A36.2.2-FIX (contrat A36.2.1) : la ligne consultée peut être
        // HYPOTHESE/OPTION/RECOMMANDATION/DECISION (contrat A30 §/C3,
        // chaîne append-only) — seule une ligne niveau=DECISION représente
        // une décision Solution réellement prise. Consulter une
        // RECOMMANDATION (ou tout niveau antérieur) ne doit jamais faire
        // croire qu'une décision existe déjà : `solutionDecisionId` reste
        // `undefined` dans ce cas, jamais rempli avec l'id de la ligne
        // consultée elle-même (c'est déjà le rôle de `decisionEntityId`).
        solutionDecisionId: option.niveau === "DECISION" ? option.id : undefined,
      };
    }
    case "MISSION": {
      const mission = await prisma.mission.findUnique({ where: { id: decisionEntityId }, select: { id: true, clientId: true, solutionDecisionId: true } });
      if (!mission) throw new DecisionEntityIntrouvableError(decisionType);
      // Liens SUPERSEDED jamais considérés actifs (contrat A36.1 §5) — même
      // filtre que F4 (lib/learning-loop/recurrence.ts, inchangé, non
      // réutilisé directement pour éviter tout couplage entre A35 et A36).
      const liens = await prisma.missionCapabilityLink.findMany({ where: { missionId: mission.id, statut: "ACTIVE" }, select: { capability: true } });
      return {
        decisionType,
        decisionEntityId,
        clientId: mission.clientId,
        capabilityIds: [...new Set(liens.map((l) => l.capability))],
        missionId: mission.id,
        // A36.2.2-FIX (contrat A36.2.1 §5) : pointeur texte déjà existant
        // (Mission.solutionDecisionId, A18) vers la SolutionOption(niveau=
        // DECISION) ayant motivé cette Mission — immuable, jamais une
        // RECOMMANDATION. Copié tel quel, jamais recalculé ; `undefined` si
        // la Mission n'a jamais été pinnée sur une décision Solution (champ
        // nullable en base).
        solutionDecisionId: mission.solutionDecisionId ?? undefined,
      };
    }
  }
}
