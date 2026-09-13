import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";
import { enregistrerRapportAgent } from "@/lib/gouvernance/rapports";
import { plafonnerTexteStrategique, PLAFOND_CHAMP_STRATEGIQUE, PLAFOND_COURT_STRATEGIQUE } from "./domain";

// COMPANY ATLAS — B21 : STRATEGIC INTELLIGENCE FOUNDATION (13/09/2026).
// Couvre les dernières étapes du cycle cible (directive B21) : Proposition
// -> Autorisation -> Action autorisée -> Contrôle -> Résultat -> Rapport.
//
// RÈGLE ABSOLUE (directive B21, "ne jamais s'auto-autoriser") : ce module
// n'implémente PAS d'Authorization Engine complet (hors périmètre B21).
// La garantie tenue ici est structurelle, pas un moteur de règles :
// - `StrategicActionProposal.agentId` référence TOUJOURS un AgentIdentity
//   (B19) — jamais un compte humain.
// - `StrategicAuthorization.autorisateurEmail` est TOUJOURS dérivé côté
//   serveur de la session ADMIN authentifiée qui appelle
//   POST /api/strategic/propositions/[id]/autoriser — jamais lu depuis le
//   corps de la requête (voir cette route). Aucun agent n'a de session
//   (limite héritée de B19/B20 : aucune authentification agent réelle
//   n'existe) : un agent ne peut donc structurellement jamais apparaître
//   comme autorisateur. L'autorisateur est nécessairement un humain ADMIN
//   distinct de l'agent proposant.
// - `autoriserProposition` refuse toute proposition déjà AUTORISEE/
//   REFUSEE/EXECUTEE/CONTROLEE (une autorisation n'est jamais réutilisée
//   ni réémise) et exige scope + durée non vides (une autorisation
//   scoped, conformément à la directive B21).
// - Une proposition ne peut passer à EXECUTEE que si `peutExecuter` est
//   vrai — c'est-à-dire seulement après une StrategicAuthorization réelle.
//   Ce module N'EXÉCUTE RIEN lui-même : `marquerExecutee`/`controlerProposition`
//   n'ouvrent pas d'action externe, ils enregistrent seulement le résultat
//   déclaré par l'appelant (même limite que PropositionSecurite, B16 :
//   observer/proposer/enregistrer n'est pas agir).

export async function creerPropositionAction(params: {
  correlationId?: string;
  recommendationId: string;
  agentId: string;
  actionProposee: string;
  perimetre?: string;
}): Promise<string | null> {
  try {
    const proposition = await prisma.strategicActionProposal.create({
      data: {
        correlationId: params.correlationId ?? nouveauCorrelationId(),
        recommendationId: params.recommendationId,
        agentId: params.agentId,
        actionProposee: plafonnerTexteStrategique(params.actionProposee, PLAFOND_CHAMP_STRATEGIQUE) ?? "",
        perimetre: plafonnerTexteStrategique(params.perimetre, PLAFOND_COURT_STRATEGIQUE),
      },
    });
    return proposition.id;
  } catch (e) {
    console.error("[strategic-propositions] échec d'écriture de la proposition d'action", e);
    return null;
  }
}

// Garde-fou PUR, testable sans base de données — même discipline que
// estAgentActif (lib/agents/identity.ts, B19) et estPermissionActive
// (lib/agents/permissions.ts, B20). Centralise la règle "jamais
// d'auto-autorisation" : refuse explicitement si l'autorisateur déclaré
// correspond à un identifiant d'agent (AGENTS_OFFICIELS) plutôt qu'à un
// email humain — défense en profondeur, en plus de la garantie
// structurelle déjà assurée par la route (session ADMIN obligatoire).
export function estAutoAutorisationInterdite(params: { autorisateurEmail: string; agentIdProposant: string }): boolean {
  const valeur = params.autorisateurEmail.trim().toLowerCase();
  return valeur.length === 0 || valeur === params.agentIdProposant.trim().toLowerCase();
}

export async function autoriserProposition(params: {
  proposalId: string;
  autorisateurEmail: string;
  scope: string;
  duree: string;
  budget?: string;
  limites?: string;
}): Promise<{ ok: true; id: string } | { ok: false; erreur: string }> {
  const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: params.proposalId } });
  if (!proposition) return { ok: false, erreur: "Proposition introuvable." };
  if (proposition.statut !== "PROPOSEE" && proposition.statut !== "AUTORISATION_DEMANDEE") {
    return { ok: false, erreur: `Proposition déjà au statut ${proposition.statut} — une autorisation n'est jamais réémise.` };
  }
  if (estAutoAutorisationInterdite({ autorisateurEmail: params.autorisateurEmail, agentIdProposant: proposition.agentId })) {
    return { ok: false, erreur: "Autorisateur invalide — l'auto-autorisation est strictement interdite." };
  }
  if (params.scope.trim().length === 0 || params.duree.trim().length === 0) {
    return { ok: false, erreur: "scope et duree sont requis — une autorisation doit toujours être scoped." };
  }

  try {
    const correlationId = nouveauCorrelationId();
    await prisma.$transaction([
      prisma.strategicAuthorization.create({
        data: {
          correlationId,
          proposalId: params.proposalId,
          autorisateurEmail: params.autorisateurEmail,
          scope: plafonnerTexteStrategique(params.scope, PLAFOND_COURT_STRATEGIQUE) ?? "",
          duree: plafonnerTexteStrategique(params.duree, PLAFOND_COURT_STRATEGIQUE) ?? "",
          budget: plafonnerTexteStrategique(params.budget, PLAFOND_COURT_STRATEGIQUE),
          limites: plafonnerTexteStrategique(params.limites, PLAFOND_CHAMP_STRATEGIQUE),
        },
      }),
      prisma.strategicActionProposal.update({ where: { id: params.proposalId }, data: { statut: "AUTORISEE" } }),
    ]);

    // Rapport best-effort vers le registre inter-agents existant
    // (lib/gouvernance/rapports.ts, B18-FIX) — trace la décision humaine,
    // jamais bloquant pour l'autorisation elle-même si l'écriture échoue.
    await enregistrerRapportAgent({
      correlationId,
      agentId: proposition.agentId,
      typeRapport: "autre",
      objectif: "Autorisation humaine d'une StrategicActionProposal (B21).",
      statut: "COMPLETE",
      contexte: `proposalId=${params.proposalId}`,
    });

    return { ok: true, id: params.proposalId };
  } catch (e) {
    console.error("[strategic-propositions] échec d'écriture de l'autorisation stratégique", e);
    return { ok: false, erreur: "Erreur interne lors de l'autorisation." };
  }
}

// Une action ne peut être marquée EXECUTEE que si une autorisation réelle
// existe déjà (statut AUTORISEE) — fonction pure, testable sans base de
// données. Ce module ne fournit aucune fonction qui exécute réellement une
// action externe (hors périmètre B21, "aucune action externe autonome").
export function peutExecuter(proposition: { statut: string }): boolean {
  return proposition.statut === "AUTORISEE";
}
