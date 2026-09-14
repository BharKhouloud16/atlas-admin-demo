import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";
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
// - B24 Lot C1 (14/09/2026) — FERMETURE STRUCTURELLE DU CHEMIN LEGACY :
//   `autoriserProposition` est désormais TOUJOURS REFUSÉE, INCONDITIONNELLEMENT,
//   pour toute NOUVELLE tentative d'autorisation — jamais seulement lorsqu'un
//   StrategicAuthorizationLink existe déjà pour la proposition (une
//   proposition qui n'en a encore aucun doit être refusée tout autant,
//   sinon elle pourrait contourner B22 — Identity, Permission scope-exacte,
//   Delegation, Commitment Lock, Risk, Human Necessity, Emergency Stop,
//   Decision — en passant par ce chemin avant d'avoir jamais atteint B22).
//   Ce module N'IMPLÉMENTE AUCUNE de ces vérifications lui-même (ce ne
//   serait qu'un second Authorization Engine, hors périmètre B21) : la
//   fermeture est purement STRUCTURELLE, jamais une règle métier dupliquée.
//   B22 (lib/control-plane/authorization.ts, creerDemandeAutorisation, NON
//   MODIFIÉ par ce lot) est désormais la SEULE autorité active pour toute
//   nouvelle autorisation, via lib/strategic/authorization-request.ts
//   (demanderAutorisationStrategique, POST .../request-authorization —
//   strictement inchangé par ce lot). Aucune donnée historique n'est
//   affectée : les StrategicAuthorization déjà créées et les propositions
//   déjà au statut AUTORISEE restent telles quelles, en lecture seule —
//   ce lot ferme uniquement la capacité d'en créer de NOUVELLES par ce
//   chemin.
// - `peutExecuter` est une fonction pure, testable sans base de données,
//   qui indique seulement si le statut AUTORISEE est atteint — condition
//   nécessaire avant toute exécution. Ce module N'EXÉCUTE RIEN lui-même et
//   ne fournit AUCUNE fonction de transition vers EXECUTEE ou CONTROLEE
//   (même limite que PropositionSecurite, B16 : observer/proposer/
//   enregistrer n'est pas agir). EXECUTEE et CONTROLEE restent déclarés
//   dans le vocabulaire fermé du cycle cible (lib/strategic/domain.ts)
//   pour un lot futur, mais aucune route ni fonction de ce module ne les
//   produit jamais dans cette fondation B21 (voir MANIFEST.md).

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

// B24 Lot C1 (14/09/2026) : chemin legacy structurellement fermé — voir
// l'en-tête de ce fichier. `params` est conservé tel quel dans la
// signature (compatibilité de l'appelant, app/api/strategic/propositions/[id]/autoriser/route.ts)
// mais n'est plus lu : aucune vérification, aucune écriture Prisma,
// aucune StrategicAuthorization n'est plus jamais créée par cette
// fonction, quel que soit le contenu de `params` (proposition existante
// ou non, statut, scope/durée, présence ou non d'un
// StrategicAuthorizationLink). Le refus est le SEUL comportement possible
// — pas une branche parmi d'autres.
export async function autoriserProposition(params: {
  proposalId: string;
  autorisateurEmail: string;
  scope: string;
  duree: string;
  budget?: string;
  limites?: string;
}): Promise<{ ok: true; id: string } | { ok: false; erreur: string }> {
  return {
    ok: false,
    erreur:
      "Autorisation directe B21 désactivée (B24 Lot C1) — toute nouvelle autorisation doit obligatoirement passer par B22 : POST /api/strategic/propositions/{id}/request-authorization.",
  };
}

// Une action ne peut être marquée EXECUTEE que si une autorisation réelle
// existe déjà (statut AUTORISEE) — fonction pure, testable sans base de
// données. Ce module ne fournit aucune fonction qui exécute réellement une
// action externe (hors périmètre B21, "aucune action externe autonome").
export function peutExecuter(proposition: { statut: string }): boolean {
  return proposition.statut === "AUTORISEE";
}
