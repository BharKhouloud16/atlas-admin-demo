import { prisma } from "@/lib/prisma";
import type { AuthorizationRequestStatus, AuthorizationDecision } from "@prisma/client";

// COMPANY ATLAS — B24 Lot C2 (14/09/2026) : STATUT D'AUTORISATION
// STRATÉGIQUE READ-DERIVED. Fermeture du dernier écart identifié en Phase
// 2.3/C1 : l'état d'autorisation d'une StrategicActionProposal ne doit
// avoir qu'UNE SEULE vérité — B22 (AuthorizationRequest.status +
// AuthorizationRequest.decision, NI MODIFIÉ ni copié par ce module). Ce
// fichier ne fait QUE lire et projeter cet état existant ; il n'écrit
// jamais, ne crée aucun champ persistant, ne synchronise rien vers
// StrategicActionProposal (qui reste, comme depuis B24 Lot C1, un simple
// historique gelé — jamais la vérité d'autorisation courante).
//
// StrategicAuthorization (legacy, B21) N'EST JAMAIS LUE ici : elle reste
// accessible comme donnée HISTORIQUE ailleurs (voir GET .../propositions,
// champ `autorisation`, inchangé par ce lot), mais ne participe plus du
// tout à la détermination de l'état COURANT — exactement la même
// distinction que B24 Lot C1 a établie côté écriture, appliquée ici côté
// lecture.

// Vocabulaire de PROJECTION (pas une nouvelle autorité, pas une nouvelle
// règle métier) — chaque valeur est dérivée mécaniquement d'une
// combinaison EXISTANTE de AuthorizationRequestStatus + AuthorizationDecision
// (B22, prisma/schema.prisma). Ne remplace ni ne redéfinit ces enums :
// leurs valeurs brutes restent exposées telles quelles (voir
// StrategicAuthorizationStatusResultat.requestStatus/decision) pour qui a
// besoin du détail B22 exact, jamais masquées derrière la seule projection.
export type StrategicAuthorizationStatusValeur =
  | "NO_AUTHORIZATION" // aucune StrategicAuthorizationLink pour cette proposition — aucune demande B22 n'a jamais été créée
  | "PENDING" // AuthorizationRequest.status === PENDING et non expirée
  | "APPROVED" // AuthorizationRequest.status === RESOLVED et decision === ALLOW
  | "REJECTED" // AuthorizationRequest.status === RESOLVED et decision === DENY
  | "EXPIRED" // AuthorizationRequest.status === EXPIRED, OU PENDING mais expiresAt déjà dépassé (voir note d'expiration ci-dessous)
  | "REVOKED" // AuthorizationRequest.status === REVOKED
  | "UNKNOWN"; // combinaison status/decision que le code B22 actuel ne produit jamais (défensif — jamais un statut inventé silencieusement)

export type StrategicAuthorizationStatusResultat = {
  statut: StrategicAuthorizationStatusValeur;
  // Détail B22 brut, jamais retraduit ni masqué — null uniquement si
  // statut === NO_AUTHORIZATION (aucune AuthorizationRequest à décrire).
  authorizationRequestId: string | null;
  requestStatus: AuthorizationRequestStatus | null;
  decision: AuthorizationDecision | null;
  expiresAt: Date | null;
};

const RESULTAT_NO_AUTHORIZATION: StrategicAuthorizationStatusResultat = {
  statut: "NO_AUTHORIZATION",
  authorizationRequestId: null,
  requestStatus: null,
  decision: null,
  expiresAt: null,
};

// Fonction PURE — aucun accès Prisma, aucune horloge implicite (`maintenant`
// est un paramètre explicite, jamais Date.now() directement à l'intérieur),
// donc entièrement testable de façon déterministe sans base de données —
// même discipline que calculerHumanNecessity (B22) et
// calculerPlafondAutonomie (B23). Prend la AuthorizationRequest B22 la plus
// RÉCENTE liée à la proposition (ou null si aucune) ; le choix de "la plus
// récente" est cohérent avec l'invariant B24 Lot B "une seule PENDING à la
// fois" et avec la cardinalité 1 → N de StrategicAuthorizationLink (B24 Lot
// A) : l'historique n'est jamais écrasé, mais seule la demande la plus
// récente détermine l'état COURANT.
export function deriverStatutAutorisationStrategique(
  demandePlusRecente: {
    id: string;
    status: AuthorizationRequestStatus;
    decision: AuthorizationDecision | null;
    expiresAt: Date;
  } | null,
  maintenant: Date = new Date()
): StrategicAuthorizationStatusResultat {
  if (!demandePlusRecente) return RESULTAT_NO_AUTHORIZATION;

  const base = {
    authorizationRequestId: demandePlusRecente.id,
    requestStatus: demandePlusRecente.status,
    decision: demandePlusRecente.decision,
    expiresAt: demandePlusRecente.expiresAt,
  };

  if (demandePlusRecente.status === "REVOKED") return { ...base, statut: "REVOKED" };
  if (demandePlusRecente.status === "EXPIRED") return { ...base, statut: "EXPIRED" };

  if (demandePlusRecente.status === "PENDING") {
    // NOTE D'EXPIRATION (honnête, non maquillée) : B22
    // (lib/control-plane/authorization.ts, approuverDemande) ne retaggue
    // une demande PENDING en EXPIRED en base QUE de façon paresseuse, au
    // moment d'une tentative d'approbation — jamais par un job de fond. Une
    // demande dont expiresAt est déjà dépassé peut donc rester status
    // PENDING en base indéfiniment tant que personne n'a tenté de
    // l'approuver. Ce module NE MODIFIE PAS ce mécanisme B22 (aucune
    // écriture ici) et N'AJOUTE AUCUN nouveau mécanisme d'expiration : il
    // se contente de REFLÉTER, en lecture seule, le même fait déjà vrai
    // (expiresAt <= maintenant) — la même vérité B22, simplement lue plus
    // tôt qu'une écriture ne l'aurait constatée.
    if (demandePlusRecente.expiresAt.getTime() <= maintenant.getTime()) {
      return { ...base, statut: "EXPIRED" };
    }
    return { ...base, statut: "PENDING" };
  }

  // status === "RESOLVED" : approuverDemande (B22) n'écrit RESOLVED qu'avec
  // decision ALLOW ou DENY (jamais APPROVAL_REQUIRED/RESTRICT/null) —
  // creerDemandeAutorisation non plus (RESOLVED n'y est posé qu'avec ALLOW
  // ou DENY, voir lib/control-plane/authorization.ts). Vérifié explicitement
  // ci-dessous plutôt que silencieusement supposé.
  if (demandePlusRecente.decision === "ALLOW") return { ...base, statut: "APPROVED" };
  if (demandePlusRecente.decision === "DENY") return { ...base, statut: "REJECTED" };
  return { ...base, statut: "UNKNOWN" };
}

// Wrapper IMPUR : lit la StrategicAuthorizationLink la plus récente de la
// proposition puis l'AuthorizationRequest B22 qu'elle référence, et délègue
// entièrement à la fonction pure ci-dessus. LECTURE SEULE — aucune écriture
// sur StrategicActionProposal, StrategicAuthorizationLink,
// AuthorizationRequest ni StrategicAuthorization (cette dernière n'est même
// jamais lue ici).
export async function obtenirStatutAutorisationStrategique(proposalId: string): Promise<StrategicAuthorizationStatusResultat> {
  const lien = await prisma.strategicAuthorizationLink.findFirst({
    where: { proposalId },
    orderBy: { createdAt: "desc" },
    select: { authorizationRequestId: true },
  });
  if (!lien) return RESULTAT_NO_AUTHORIZATION;

  // authorizationRequestId n'est PAS une FK Prisma (texte libre par
  // construction, voir StrategicAuthorizationLink, B24 Lot A) — si la ligne
  // B22 référencée n'existe plus (aucune route DELETE n'existe sur
  // AuthorizationRequest à ce jour, donc ne devrait jamais arriver),
  // traiter comme NO_AUTHORIZATION plutôt que de planter ou d'inventer un
  // état.
  const demande = await prisma.authorizationRequest.findUnique({
    where: { id: lien.authorizationRequestId },
    select: { id: true, status: true, decision: true, expiresAt: true },
  });
  if (!demande) return RESULTAT_NO_AUTHORIZATION;

  return deriverStatutAutorisationStrategique(demande);
}

// B27 (14/09/2026) : variante qui retourne la ligne AuthorizationRequest
// COMPLÈTE (agentId/action/scope/correlationId inclus, pas seulement le
// sous-ensemble utilisé par la dérivation de statut ci-dessus) — nécessaire
// pour dériver, côté serveur et jamais depuis le client, les paramètres
// exacts d'un appel à guardExecution() (B25) pour CETTE proposition. Même
// sélection "Link le plus récent" que obtenirStatutAutorisationStrategique
// ci-dessus (dupliquée en 6 lignes plutôt que refactorée en commun, pour
// ne prendre AUCUN risque de modifier silencieusement le comportement déjà
// testé et livré de la fonction existante — voir PR #19/#20). Lecture
// seule, aucune écriture.
export async function obtenirDemandeCouranteStrategique(proposalId: string) {
  const lien = await prisma.strategicAuthorizationLink.findFirst({
    where: { proposalId },
    orderBy: { createdAt: "desc" },
    select: { authorizationRequestId: true },
  });
  if (!lien) return null;

  return prisma.authorizationRequest.findUnique({ where: { id: lien.authorizationRequestId } });
}
