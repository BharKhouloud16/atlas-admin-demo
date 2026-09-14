import { prisma } from "@/lib/prisma";
import {
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";
import { estAutonomyLevelValide, estAutonomyLevelSupporte, type AutonomyLevelValeur } from "@/lib/control-plane/domain";
import { creerDemandeAutorisation, revoquerDemande } from "@/lib/control-plane/authorization";
import { plafonnerTexteStrategique, PLAFOND_CHAMP_STRATEGIQUE } from "./domain";

// COMPANY ATLAS — B24 Lot B (14/09/2026) : SEUL chemin capable de faire
// naître une AuthorizationRequest B22 depuis une StrategicActionProposal
// B21. N'implémente AUCUNE logique d'autorisation propre — appelle
// intégralement creerDemandeAutorisation() (lib/control-plane/authorization.ts,
// B22, NON MODIFIÉ par ce lot) qui reste la SEULE autorité (Identity,
// Permission scope-exacte depuis B24-FIX0, Delegation, Commitment Lock,
// Risk, Human Necessity, Emergency Stop, Decision). Ce module ne fait que
// PRÉPARER une demande conforme et TRAÇABLE — jamais un second Authorization
// Engine (directive B24 Lot B, section 4/13).
//
// PORTÉE DÉLIBÉRÉMENT ABSENTE DE CE LOT (à ne jamais réintroduire ici) :
// - Aucune synchronisation de StrategicActionProposal.statut (Lot C) : la
//   vérification "une seule PENDING à la fois" (voir plus bas) ne dépend
//   JAMAIS de ce champ, uniquement de StrategicAuthorizationLink +
//   AuthorizationRequest.status lus en direct — donc AUCUNE écriture sur
//   statut n'est techniquement nécessaire pour ce lot (vérifié, pas supposé).
// - Aucun "proposal freeze" nouveau : à la date de ce lot, AUCUNE route ne
//   permet de modifier agentId/correlationId/actionProposee/perimetre d'une
//   StrategicActionProposal existante (grep exhaustif sur app/api/strategic/ —
//   aucun PATCH/PUT/DELETE n'existe). L'invariant "contexte jamais modifié
//   pendant PENDING" est donc déjà structurellement vrai aujourd'hui, sans
//   code supplémentaire — documenté ici plutôt que silencieusement supposé.
//   Si une route de modification de proposition est créée plus tard, CE
//   COMMENTAIRE cesse d'être vrai et un gel explicite devra être ajouté
//   avant cette route (pas dans ce lot).

// Statuts B21 terminaux au sens de la RÈGLE MÉTIER DÉJÀ EXISTANTE (voir
// lib/strategic/propositions.ts, autoriserProposition) — jamais réémis.
// Réutilisés tels quels, aucune nouvelle règle inventée ici.
const STATUTS_PROPOSAL_TERMINAUX = new Set(["AUTORISEE", "REFUSEE", "EXECUTEE", "CONTROLEE"]);

type ProposalVerrouillee = {
  id: string;
  agentId: string;
  correlationId: string;
  statut: string;
  perimetre: string | null;
};

export type DemandeAutorisationStrategiqueResultat =
  | {
      ok: true;
      authorizationRequestId: string;
      linkId: string;
      status: string;
      decision: string | null;
      humanNecessity: string | null;
    }
  | { ok: false; erreur: string; code: 400 | 404 | 409 };

export async function demanderAutorisationStrategique(params: {
  proposalId: string;
  action: unknown;
  scope: unknown;
  requestedAutonomyLevel: unknown;
}): Promise<DemandeAutorisationStrategiqueResultat> {
  // Validation des vocabulaires fermés AVANT toute ouverture de transaction
  // — aucune raison de verrouiller une ligne pour un input structurellement
  // invalide. Directive B24 Lot B, section 5 : AUCUN mapping automatique
  // StrategicCategory -> scope ; action/scope proviennent EXCLUSIVEMENT
  // d'une sélection humaine explicite (corps de la requête), jamais dérivés
  // de la proposition elle-même.
  if (!estAgentPermissionActionValide(params.action)) {
    return { ok: false, erreur: "action invalide (vocabulaire AgentPermissionAction, B20) — aucune AuthorizationRequest créée.", code: 400 };
  }
  if (!estAgentPermissionScopeValide(params.scope)) {
    return { ok: false, erreur: "scope invalide (vocabulaire AgentPermissionScope, B20) — aucune AuthorizationRequest créée.", code: 400 };
  }
  if (!estAutonomyLevelValide(params.requestedAutonomyLevel)) {
    return { ok: false, erreur: "requestedAutonomyLevel invalide.", code: 400 };
  }
  if (!estAutonomyLevelSupporte(params.requestedAutonomyLevel)) {
    return {
      ok: false,
      erreur: `requestedAutonomyLevel ${params.requestedAutonomyLevel} non supporté (maximum : L4_EXECUTE_WITH_APPROVAL).`,
      code: 400,
    };
  }
  const action = params.action as AgentPermissionActionValeur;
  const scope = params.scope as AgentPermissionScopeValeur;
  const requestedAutonomyLevel = params.requestedAutonomyLevel as AutonomyLevelValeur;

  // Capture, hors du type de retour de la transaction, l'id d'une
  // AuthorizationRequest B22 créée mais jugée incohérente — permet la
  // mitigation par révocation après la transaction (voir plus bas) sans
  // complexifier l'union de retour de $transaction.
  let aRevoquerApresRollback: string | null = null;

  // BEGIN — verrou transactionnel sur la proposition (directive B24 Lot B,
  // section 10) : SELECT ... FOR UPDATE, jamais un simple "SELECT puis
  // INSERT" (race-prone sous PostgreSQL Read Committed). Deux appels
  // concurrents pour la MÊME proposalId se sérialisent ici : le second
  // bloque jusqu'à la fin de la transaction du premier.
  const resultatTx = await prisma.$transaction(async (tx) => {
    const lignes = await tx.$queryRaw<ProposalVerrouillee[]>`
      SELECT "id", "agentId", "correlationId", "statut", "perimetre"
      FROM "StrategicActionProposal"
      WHERE "id" = ${params.proposalId}
      FOR UPDATE
    `;
    const proposal = lignes[0];
    if (!proposal) {
      return { ok: false as const, erreur: "Proposition introuvable.", code: 404 as const };
    }
    if (STATUTS_PROPOSAL_TERMINAUX.has(proposal.statut)) {
      return {
        ok: false as const,
        erreur: `Proposition déjà au statut ${proposal.statut} — une demande d'autorisation ne peut plus être créée.`,
        code: 409 as const,
      };
    }

    // Un seul PENDING à la fois (directive B24 Lot B, section 10) — dérivé
    // en LIVE depuis StrategicAuthorizationLink + AuthorizationRequest.status,
    // jamais depuis un champ dénormalisé sur la proposition ou le lien
    // (aucun champ status/decision n'existe sur StrategicAuthorizationLink,
    // par construction — Lot A, section 4).
    const liensExistants = await tx.strategicAuthorizationLink.findMany({
      where: { proposalId: proposal.id },
      select: { authorizationRequestId: true },
    });
    if (liensExistants.length > 0) {
      const demandesEnCours = await tx.authorizationRequest.findMany({
        where: { id: { in: liensExistants.map((l) => l.authorizationRequestId) }, status: "PENDING" },
        select: { id: true },
      });
      if (demandesEnCours.length > 0) {
        return {
          ok: false as const,
          erreur: "Une AuthorizationRequest PENDING existe déjà pour cette proposition — une seule à la fois.",
          code: 409 as const,
        };
      }
    }

    // agentId et correlationId TOUJOURS dérivés de la proposition verrouillée
    // — jamais du corps de la requête (directive B24 Lot B, sections 6/7).
    // objective/reason dérivés du contenu réel de la proposition, jamais
    // fournis par le client à ce niveau (payload minimal, section 18 de
    // l'ordre : seuls action/scope/requestedAutonomyLevel sont acceptés).
    //
    // NOTE D'ATOMICITÉ (honnête, non maquillée) : creerDemandeAutorisation()
    // est un mécanisme B22 EXISTANT, NON MODIFIÉ — il utilise son propre
    // client Prisma top-level (prisma.authorizationRequest.create), pas
    // `tx`. Son écriture n'est donc PAS dans la même transaction SQL que ce
    // verrou. Le verrou FOR UPDATE sur la proposition reste néanmoins ce qui
    // sérialise réellement les appelants concurrents (voir section PENDING
    // ci-dessus) : tant que cette transaction n'a pas COMMIT, aucun autre
    // appel sur la MÊME proposalId ne peut avancer au-delà de son propre
    // SELECT ... FOR UPDATE. Le risque résiduel n'est donc PAS un double
    // PENDING, mais un STRATEGICAUTHORIZATIONLINK ORPHELIN si l'écriture du
    // Link échoue APRÈS que B22 a déjà committé son AuthorizationRequest —
    // cas traité ci-dessous par révocation explicite (jamais par une
    // tentative de "rollback" d'un commit déjà acquis par une autre
    // transaction, ce qui est impossible).
    const resultatB22 = await creerDemandeAutorisation({
      correlationId: proposal.correlationId,
      agentId: proposal.agentId,
      action,
      scope,
      resource: proposal.perimetre ?? undefined,
      objective: plafonnerTexteStrategique(`StrategicActionProposal ${proposal.id}`, PLAFOND_CHAMP_STRATEGIQUE) ?? proposal.id,
      reason: "Demande d'autorisation créée depuis une StrategicActionProposal (B21 → B22, B24 Lot B).",
      requestedAutonomyLevel,
    });
    if (!resultatB22.ok) {
      return { ok: false as const, erreur: resultatB22.erreur, code: 409 as const };
    }

    // Vérification défensive du contexte avant toute création de lien
    // (directive B24 Lot B, section 9) — sous fonctionnement normal, ne
    // peut pas échouer (ces valeurs sont celles-là mêmes qu'on vient de
    // transmettre), mais vérifiée explicitement plutôt que silencieusement
    // supposée, même discipline que le reste de ce projet.
    const demandeCreee = await tx.authorizationRequest.findUnique({ where: { id: resultatB22.id } });
    const coherente =
      !!demandeCreee &&
      demandeCreee.agentId === proposal.agentId &&
      demandeCreee.correlationId === proposal.correlationId &&
      demandeCreee.action === action &&
      demandeCreee.scope === scope;
    if (!coherente) {
      aRevoquerApresRollback = resultatB22.id;
      return { ok: false as const, erreur: "AuthorizationRequest créée incohérente avec le contexte attendu — annulée.", code: 409 as const };
    }

    const lien = await tx.strategicAuthorizationLink.create({
      data: {
        correlationId: proposal.correlationId,
        proposalId: proposal.id,
        authorizationRequestId: resultatB22.id,
      },
    });

    return {
      ok: true as const,
      authorizationRequestId: resultatB22.id,
      linkId: lien.id,
      status: resultatB22.status,
      decision: resultatB22.decision,
      humanNecessity: resultatB22.humanNecessity,
    };
  });

  // Mitigation de l'orphelin défensif (voir note d'atomicité ci-dessus) :
  // si l'incohérence défensive a été détectée, l'AuthorizationRequest B22
  // existe déjà (committée par son propre mécanisme) mais AUCUN Link n'a
  // été créé (la transaction ci-dessus a fait ROLLBACK avant le create) —
  // on la révoque explicitement via le mécanisme B22 existant plutôt que
  // de la laisser PENDING/ALLOW sans lien, jamais une suppression (B22
  // n'expose aucune fonction de suppression, par design).
  if (!resultatTx.ok && aRevoquerApresRollback) {
    await revoquerDemande({
      id: aRevoquerApresRollback,
      revokedBy: "system",
      reason: "B24 Lot B : AuthorizationRequest incohérente avec le contexte StrategicActionProposal attendu — révoquée automatiquement, aucun StrategicAuthorizationLink créé.",
    });
  }

  return resultatTx;
}
