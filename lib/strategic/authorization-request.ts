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
//
// B24 Lot B-FIX1 (14/09/2026) — COMPENSATION D'ATOMICITÉ INTER-SYSTÈMES :
// creerDemandeAutorisation() (B22) committe l'AuthorizationRequest via son
// PROPRE client Prisma top-level, PAS via `tx` — donc HORS de la
// transaction SQL de ce module (voir NOTE D'ATOMICITÉ plus bas, inchangée
// dans son principe depuis Lot B). Toute erreur survenant APRÈS ce commit
// (échec de StrategicAuthorizationLink.create, ou toute exception
// inattendue) empêchait jusqu'ici toute compensation : l'exception
// propageait hors de prisma.$transaction() sans jamais exécuter la
// révocation. Corrigé ici par un try/catch englobant, qui capture l'id de
// l'AuthorizationRequest DÈS que B22 confirme sa création (avant toute
// opération risquée ultérieure) et tente sa révocation dans TOUS les cas
// où une erreur survient après ce point — jamais seulement le cas de
// l'incohérence défensive (seul cas couvert par le Lot B initial).
// Compensation BEST-EFFORT, explicite, tracée par le mécanisme B22
// existant (revoquerDemande) — jamais une suppression physique, jamais un
// camouflage de l'erreur d'origine si la compensation elle-même échoue.

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
  | { ok: false; erreur: string; code: 400 | 404 | 409 | 500 };

// Compensation best-effort : révoque (JAMAIS ne supprime) une
// AuthorizationRequest B22 déjà commitée mais orpheline (aucun
// StrategicAuthorizationLink correspondant). Idempotente vis-à-vis d'une
// révocation déjà en cours/effectuée : "déjà révoquée" est traité comme un
// succès de compensation (l'objectif — statut != PENDING — est déjà
// atteint), jamais comme un échec à remonter.
//
// B24 Lot B-FIX1.2 : `revoquerDemandeImpl` est une INJECTION DE DÉPENDANCE
// ordinaire — jamais un interrupteur de test. La production passe TOUJOURS
// `revoquerDemande` (B22, non modifié, voir demanderAutorisationStrategique
// ci-dessous) ; seul un test peut fournir une implémentation alternative,
// via le second argument (dependances) de demanderAutorisationStrategique —
// jamais via `params`, qui ne porte plus aucun indicateur de simulation.
async function tenterRevocationCompensatoire(
  id: string,
  motif: string,
  revoquerDemandeImpl: typeof revoquerDemande
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  try {
    const resultat = await revoquerDemandeImpl({
      id,
      revokedBy: "system",
      reason: plafonnerTexteStrategique(`B24 Lot B-FIX1 — compensation automatique : ${motif}.`, PLAFOND_CHAMP_STRATEGIQUE) ?? motif,
    });
    if (resultat.ok) return { ok: true };
    if (resultat.erreur.includes("déjà révoquée")) return { ok: true };
    return { ok: false, erreur: resultat.erreur };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}

// B24 Lot B-FIX1.1 — factorisation du SEUL cas partagé entre CAS B et CAS
// C/D : la compensation elle-même échoue. Jamais utilisé pour le cas de
// succès de la compensation, dont la sémantique reste distincte et propre
// à chaque cas (CAS B renvoie l'erreur métier telle quelle ; CAS C/D
// renvoie un message décrivant la révocation) — aucune exception
// artificielle, aucun cas transformé pour ressembler à l'autre. L'échec
// initial ET l'échec de compensation restent tous deux explicitement
// détectables, jamais l'un masquant l'autre.
function erreurCompensationEchouee(
  erreurOrigine: string,
  authorizationRequestId: string,
  erreurCompensation: string
): { ok: false; erreur: string; code: 500 } {
  return {
    ok: false,
    erreur: `${erreurOrigine} — ÉCHEC ÉGALEMENT de la compensation par révocation (${erreurCompensation}) : AuthorizationRequest ${authorizationRequestId} peut rester active sans lien, intervention manuelle requise.`,
    code: 500,
  };
}

export async function demanderAutorisationStrategique(params: {
  proposalId: string;
  action: unknown;
  scope: unknown;
  requestedAutonomyLevel: unknown;
  // Réservé aux TESTS (B24 Lot B-FIX1) — jamais lu depuis une requête HTTP
  // (la route ne le transmet jamais, voir app/api/strategic/propositions/[id]/request-authorization/route.ts),
  // donc structurellement inaccessible à un client. Provoque une
  // défaillance RÉELLE et déterministe de l'étape StrategicAuthorizationLink.create
  // pour valider la compensation par révocation (CAS C de l'ordre). Un
  // monkey-patch des internes Prisma (tx.strategicAuthorizationLink.create)
  // a été testé et écarté : il ne s'applique pas au client transactionnel
  // (instance distincte du client top-level) et un patch au niveau du
  // prototype fait planter le moteur de requêtes natif (Rust) — vérifié
  // empiriquement, pas supposé. Ce seau est donc le mécanisme sûr et
  // minimal recommandé par l'ordre pour "démontrer le comportement réel de
  // compensation" sans modifier B22 ni fragiliser le moteur Prisma.
  _simulerEchecCreationLienPourTest?: boolean;
  // Réservé aux TESTS (B24 Lot B-FIX1), même discipline que ci-dessus —
  // force la vérification défensive de cohérence (CAS B) à échouer, pour
  // valider sa propre compensation par révocation. Sous fonctionnement
  // normal, cette incohérence ne peut jamais se produire (les valeurs
  // comparées proviennent du même appel) — ce seau est le seul moyen sûr de
  // l'exercer réellement sans corrompre B22.
  _forcerIncoherenceDefensivePourTest?: boolean;
},
// B24 Lot B-FIX1.2 : injection de dépendance ORDINAIRE, PAS un paramètre
// métier — absente de `params` ci-dessus, donc un appel normal
// (demanderAutorisationStrategique({ proposalId, action, scope,
// requestedAutonomyLevel })) n'a besoin d'aucun deuxième argument, et ne
// porte plus aucun indicateur `_simulerEchecCompensationPourTest`. La
// route HTTP (app/api/strategic/propositions/[id]/request-authorization/route.ts)
// n'appelle jamais ce deuxième argument — la production utilise donc
// TOUJOURS `revoquerDemande` (B22, non modifié) par défaut. Seul un test
// peut fournir une implémentation alternative de la révocation, pour
// exercer le comportement réel de compensation sans corrompre B22 ni
// ajouter d'interrupteur au contrat métier.
dependances?: { revoquerDemande?: typeof revoquerDemande }
): Promise<DemandeAutorisationStrategiqueResultat> {
  const revoquerDemandeReel = dependances?.revoquerDemande ?? revoquerDemande;
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

  // Capturé DÈS que B22 confirme la création de l'AuthorizationRequest —
  // avant toute opération ultérieure risquée (vérification défensive,
  // création du Link). Toute erreur survenant à partir de ce point déclenche
  // la compensation (voir catch ci-dessous), quelle qu'en soit la cause
  // exacte (CAS C ou CAS D de l'ordre — traités identiquement, sans
  // distinction artificielle, puisque les deux partagent le même invariant :
  // "AuthorizationRequest commitée, aucun Link créé").
  let authorizationRequestIdCommise: string | null = null;
  // Cas spécifique où la transaction s'est terminée PROPREMENT (rollback
  // normal, pas d'exception) mais a jugé la demande incohérente — la
  // compensation peut alors attendre la fin propre de la transaction
  // (aucune différence de résultat, mais plus simple à lire).
  let aRevoquerApresRollbackPropre: string | null = null;

  let resultatTx: DemandeAutorisationStrategiqueResultat;
  try {
    // BEGIN — verrou transactionnel sur la proposition (directive B24 Lot B,
    // section 10) : SELECT ... FOR UPDATE, jamais un simple "SELECT puis
    // INSERT" (race-prone sous PostgreSQL Read Committed). Deux appels
    // concurrents pour la MÊME proposalId se sérialisent ici : le second
    // bloque jusqu'à la fin de la transaction du premier.
    resultatTx = await prisma.$transaction(async (tx) => {
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
      // NOTE D'ATOMICITÉ (honnête, non maquillée — inchangée depuis Lot B) :
      // creerDemandeAutorisation() est un mécanisme B22 EXISTANT, NON
      // MODIFIÉ — il utilise son propre client Prisma top-level
      // (prisma.authorizationRequest.create), pas `tx`. Son écriture n'est
      // donc PAS dans la même transaction SQL que ce verrou. Le verrou FOR
      // UPDATE sur la proposition reste néanmoins ce qui sérialise
      // réellement les appelants concurrents (voir section PENDING
      // ci-dessus) : tant que cette transaction n'a pas COMMIT/ROLLBACK,
      // aucun autre appel sur la MÊME proposalId ne peut avancer au-delà de
      // son propre SELECT ... FOR UPDATE. Le risque résiduel n'est donc PAS
      // un double PENDING durable, mais une fenêtre BRÈVE où une
      // AuthorizationRequest orpheline (pas encore compensée) coexiste avec
      // une nouvelle demande légitime créée juste après la fin de CETTE
      // transaction — voir "Risques résiduels" du rapport B24 Lot B-FIX1 ;
      // fenêtre auto-cicatrisante (la compensation ci-dessous s'exécute
      // immédiatement après), jamais un contournement de permission (B24
      // Lot B-FIX1, section "ATTENTION À LA CONCURRENCE").
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
        // CAS A (ordre, B24 Lot B-FIX1) : B22 n'a rien commité — aucune
        // compensation n'est nécessaire ni possible.
        return { ok: false as const, erreur: resultatB22.erreur, code: 409 as const };
      }
      // À partir d'ici, l'AuthorizationRequest existe réellement et est
      // commitée côté B22 — toute erreur désormais déclenche compensation.
      authorizationRequestIdCommise = resultatB22.id;

      // Vérification défensive du contexte avant toute création de lien
      // (directive B24 Lot B, section 9) — sous fonctionnement normal, ne
      // peut pas échouer (ces valeurs sont celles-là mêmes qu'on vient de
      // transmettre), mais vérifiée explicitement plutôt que silencieusement
      // supposée, même discipline que le reste de ce projet.
      const demandeCreee = await tx.authorizationRequest.findUnique({ where: { id: resultatB22.id } });
      const coherente =
        !params._forcerIncoherenceDefensivePourTest &&
        !!demandeCreee &&
        demandeCreee.agentId === proposal.agentId &&
        demandeCreee.correlationId === proposal.correlationId &&
        demandeCreee.action === action &&
        demandeCreee.scope === scope;
      if (!coherente) {
        // CAS B (ordre) — la transaction se termine proprement (rollback
        // normal, pas d'exception) ; la compensation est déclenchée juste
        // après, hors transaction.
        aRevoquerApresRollbackPropre = resultatB22.id;
        return { ok: false as const, erreur: "AuthorizationRequest créée incohérente avec le contexte attendu — annulée.", code: 409 as const };
      }

      // CAS C (ordre) : point d'injection de test — jamais atteignable
      // depuis la route HTTP (voir documentation du paramètre). Provoque
      // une défaillance RÉELLE de cette étape précise, exactement comme le
      // ferait une vraie erreur Prisma/réseau à cet instant précis.
      if (params._simulerEchecCreationLienPourTest) {
        throw new Error("Échec simulé de StrategicAuthorizationLink.create (B24 Lot B-FIX1, test de compensation uniquement).");
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
  } catch (erreurInattendue) {
    // CAS C / CAS D (ordre) : une exception a interrompu la transaction
    // APRÈS que B22 a déjà commité son AuthorizationRequest (hors de cette
    // transaction — voir NOTE D'ATOMICITÉ). PostgreSQL/Prisma a déjà annulé
    // tout ce que CETTE transaction avait elle-même écrit (rien, dans ce
    // cas, puisque le Link n'a jamais été créé) — mais ne peut évidemment
    // pas annuler le commit déjà acquis par B22 dans SA propre transaction.
    // Compensation best-effort, explicite, jamais silencieuse.
    const messageOriginal = erreurInattendue instanceof Error ? erreurInattendue.message : String(erreurInattendue);
    if (authorizationRequestIdCommise) {
      const compensation = await tenterRevocationCompensatoire(
        authorizationRequestIdCommise,
        `échec après création B22 (${messageOriginal})`,
        revoquerDemandeReel
      );
      if (!compensation.ok) {
        // Erreur d'origine ET échec de compensation restent tous deux
        // explicitement détectables — jamais l'un masqué par l'autre, et
        // jamais une compensation silencieusement supposée réussie.
        return erreurCompensationEchouee(
          `Échec de création du StrategicAuthorizationLink (${messageOriginal})`,
          authorizationRequestIdCommise,
          compensation.erreur
        );
      }
      return {
        ok: false,
        erreur: `Échec de création du StrategicAuthorizationLink — AuthorizationRequest ${authorizationRequestIdCommise} révoquée automatiquement par compensation. Erreur d'origine : ${messageOriginal}`,
        code: 409,
      };
    }
    // Aucune AuthorizationRequest B22 n'avait encore été commitée avant
    // cette erreur (ex. échec du verrou, de la lecture de la proposition,
    // ou de creerDemandeAutorisation lui-même) — rien à compenser.
    return { ok: false, erreur: `Erreur interne lors de la création de la demande d'autorisation : ${messageOriginal}`, code: 500 };
  }

  // CAS B — compensation après un rollback PROPRE (pas d'exception) de la
  // transaction, pour l'incohérence défensive détectée ci-dessus.
  //
  // B24 Lot B-FIX1.1 : le résultat de tenterRevocationCompensatoire()
  // n'était jusqu'ici jamais examiné — corrigé pour la même discipline que
  // CAS C/D (voir bloc catch ci-dessus) :
  // - compensation réussie -> l'erreur métier d'origine (resultatTx) est
  //   retournée TELLE QUELLE, inchangée (CAS B1 de l'ordre) ;
  // - compensation échouée -> l'erreur d'origine ET l'échec de
  //   compensation sont tous deux explicitement retournés, jamais l'un
  //   silencieusement ignoré (CAS B2 de l'ordre), via le même helper que
  //   CAS C/D — aucune exception artificielle introduite pour cela.
  if (!resultatTx.ok && aRevoquerApresRollbackPropre) {
    const compensation = await tenterRevocationCompensatoire(
      aRevoquerApresRollbackPropre,
      "AuthorizationRequest créée incohérente avec le contexte attendu",
      revoquerDemandeReel
    );
    if (!compensation.ok) {
      return erreurCompensationEchouee(resultatTx.erreur, aRevoquerApresRollbackPropre, compensation.erreur);
    }
  }

  return resultatTx;
}
