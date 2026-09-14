import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { listerPermissionsAgent } from "@/lib/agents/permissions";
import { calculerPlafondAutonomie, type ParametresPlafondAutonomie } from "@/lib/control-plane/autonomy";
import { classifierAction } from "@/lib/control-plane/commitment";
import { estArreteUrgenceActif } from "@/lib/control-plane/emergency-stop";
import { estAutonomyLevelValide, estCorrelationIdValide, type AutonomyLevelValeur, type RiskLevelValeur, type EvidenceQualityValeur } from "@/lib/control-plane/domain";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B23 LOT 2 (14/09/2026) : READ-ONLY AUTONOMY CEILING API
// (GO CEO limité à ce seul lot, correction ciblée B23-FIX1 déjà intégrée).
//
// CE QUE CETTE ROUTE EST : un point d'entrée GET, ADMIN uniquement,
// strictement en LECTURE, qui expose calculerPlafondAutonomie() (B23 Lot 1
// + B23-FIX1, lib/control-plane/autonomy.ts) au Control Plane. Elle
// authentifie, vérifie ADMIN, valide/relit les données nécessaires, appelle
// la fonction pure telle quelle, et retourne son résultat — RIEN d'autre.
//
// CE QUE CETTE ROUTE N'EST PAS (limite absolue, directive B23 Lot 2) :
// - Ce n'est JAMAIS une autorisation. Le champ `autonomyCeiling` est une
//   ÉVALUATION advisory (même nommage que le moteur, EvaluationPlafondAutonomie)
//   — jamais "AUTHORIZED", jamais utilisable pour exécuter quoi que ce soit.
//   B22 (lib/control-plane/authorization.ts) reste l'UNIQUE autorité
//   d'autorisation ; cette route ne l'appelle jamais, ne crée jamais
//   d'AuthorizationRequest, ne modifie jamais Delegation/AgentPermission/
//   AgentIdentity/EmergencyStop.
// - AUCUNE écriture base de données : uniquement des lectures
//   (AgentIdentity, AgentPermission, Delegation, EmergencyStop, toutes déjà
//   B19/B20/B22) — aucun nouveau modèle, aucun AutonomyEvent, aucune
//   persistance de l'évaluation elle-même.
// - AUCUN second moteur d'autonomie : calculerPlafondAutonomie() est
//   appelée telle quelle, avec exactement son contrat existant — cette
//   route ne fait que construire ses paramètres à partir de lectures déjà
//   existantes (mêmes primitives que lib/control-plane/authorization.ts :
//   listerAgentsIdentity, listerPermissionsAgent, prisma.delegation.
//   findUnique, estArreteUrgenceActif, classifierAction).
//
// FAIL-CLOSED RUNTIME (cohérent avec B23-FIX1) : action/scope/riskLevel/
// evidenceQuality proviennent de query params (donc toujours de simples
// chaînes, jamais garanties valides par TypeScript) et sont transmis TELS
// QUELS à calculerPlafondAutonomie(), qui les revalide elle-même en
// interne et applique son propre plafond fail-closed pour toute valeur
// hors vocabulaire fermé — cette route ne réimplémente aucune deuxième
// logique de validation de ces champs, elle réutilise le moteur (même
// principe que P1 de B23-FIX1 : une valeur explicitement fournie mais
// invalide n'est jamais traitée comme une absence). Seuls agentId,
// requestedAutonomyLevel, correlationId et montantDemande sont validés au
// niveau de la route : ce sont des paramètres structurels de la requête
// (identité de la ressource évaluée, format numérique, longueur), pas des
// valeurs du vocabulaire fermé que le moteur sait déjà évaluer lui-même.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  const agentId = searchParams.get("agentId");
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId requis." }, { status: 400 });
  }

  // B21.1 — estCorrelationIdValide réutilisée telle quelle (jamais une
  // seconde règle) : ≤300 caractères accepté, >300 refusé (400), jamais
  // tronqué silencieusement. Purement traçabilité ici (rien n'est
  // persisté) — un correlationId absent en génère un nouveau pour la
  // réponse, jamais stocké.
  const correlationIdBrut = searchParams.get("correlationId");
  if (correlationIdBrut !== null && !estCorrelationIdValide(correlationIdBrut)) {
    return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
  }
  const correlationId = correlationIdBrut ?? nouveauCorrelationId();

  // requestedAutonomyLevel : vocabulaire fermé complet (L0-L6, B22 domain)
  // — L5/L6 sont volontairement ACCEPTÉS ici (jamais rejetés en 400) : le
  // moteur les ramène structurellement au plafond gouvernance L4 (voir
  // calculerPlafondAutonomie, PLAFOND_GOUVERNANCE), c'est exactement ce que
  // cette évaluation doit pouvoir démontrer. estAutonomyLevelSupporte
  // (qui rejette L5/L6) n'est PAS utilisée ici — elle sert uniquement à
  // B22 au moment d'ÉCRIRE une AuthorizationRequest, jamais à une simple
  // évaluation en lecture.
  const requestedAutonomyLevelBrut = searchParams.get("requestedAutonomyLevel");
  if (!estAutonomyLevelValide(requestedAutonomyLevelBrut)) {
    return NextResponse.json(
      { error: "requestedAutonomyLevel requis et doit appartenir au vocabulaire AutonomyLevel (B22)." },
      { status: 400 }
    );
  }
  const requestedAutonomyLevel: AutonomyLevelValeur = requestedAutonomyLevelBrut;

  // action/scope : transmis TELS QUELS (unknown) à calculerPlafondAutonomie
  // — jamais validés ici, voir le commentaire d'en-tête (fail-closed
  // réutilisé depuis le moteur, jamais dupliqué).
  const action = searchParams.get("action") ?? undefined;
  const scope = searchParams.get("scope") ?? undefined;

  // riskLevel/evidenceQuality : même principe — une valeur hors
  // vocabulaire fermé n'est jamais rejetée ici en 400, elle est transmise
  // telle quelle et c'est calculerPlafondAutonomie() qui applique son
  // propre plafond fail-closed (PLAFOND_RUNTIME_INVALIDE, B23-FIX1). Le
  // cast est intentionnel et documenté : TypeScript ne protège que la
  // compilation, pas une chaîne réellement reçue depuis un query param —
  // exactement la même discipline que ParametresPlafondAutonomie.action/
  // scope (unknown) dans lib/control-plane/autonomy.ts.
  const riskLevelBrut = searchParams.get("riskLevel");
  const evidenceQualityBrut = searchParams.get("evidenceQuality");
  const riskLevel = (riskLevelBrut ?? undefined) as RiskLevelValeur | undefined;
  const evidenceQuality = (evidenceQualityBrut ?? undefined) as EvidenceQualityValeur | undefined;

  // montantDemande : paramètre numérique structurel (pas un vocabulaire
  // fermé) — une valeur fournie mais non numérique est une erreur de
  // requête, refusée en 400 (même discipline que POST .../authorization-
  // requests pour `amount`).
  const montantDemandeBrut = searchParams.get("montantDemande");
  let montantDemande: number | undefined;
  if (montantDemandeBrut !== null) {
    const parsed = Number(montantDemandeBrut);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "montantDemande invalide : doit être un nombre." }, { status: 400 });
    }
    montantDemande = parsed;
  }

  const delegationId = searchParams.get("delegationId") ?? undefined;

  try {
    // IDENTITY — lue telle quelle (B19, listerAgentsIdentity). Un agentId
    // qui ne correspond à aucune identité n'est PAS refusé en 400 : c'est
    // exactement ce que la dimension IDENTITY de calculerPlafondAutonomie
    // est conçue pour évaluer (agent introuvable = traité comme non ACTIVE,
    // blocked=true dans le résultat) — refuser ici en 400 empêcherait
    // cette route d'exposer fidèlement ce cas.
    const agents = await listerAgentsIdentity();
    const agentTrouve = agents.find((a) => a.id === agentId);
    const agent = agentTrouve ? { statut: agentTrouve.statut } : null;

    // PERMISSION — lue telle quelle (B20, listerPermissionsAgent), jamais
    // filtrée ici : calculerPlafondAutonomie() applique elle-même
    // possedePermissionActive() en scope exact (B23-FIX1).
    const permissions = await listerPermissionsAgent();

    // DELEGATION — optionnelle. Un delegationId qui ne référence aucune
    // Delegation de cet agent est une erreur de requête (400), même
    // discipline que POST .../authorization-requests.
    let delegation: Awaited<ReturnType<typeof prisma.delegation.findUnique>> = null;
    if (delegationId) {
      delegation = await prisma.delegation.findUnique({ where: { id: delegationId } });
      if (!delegation || delegation.agentId !== agentId) {
        return NextResponse.json(
          { error: "delegationId invalide : doit référencer une Delegation existante de cet agent." },
          { status: 400 }
        );
      }
    }

    // EMERGENCY STOP — revérifié EN DIRECT (jamais en cache), même
    // primitive que B22 (estArreteUrgenceActif). classifierAction()
    // rappelée ici pour obtenir actionClass : même pattern exact que
    // creerDemandeAutorisation (lib/control-plane/authorization.ts) —
    // aucune nouvelle logique de sécurité, uniquement la réutilisation de
    // la fonction déjà existante.
    const actionClass = classifierAction(action);
    const emergencyStopActif = await estArreteUrgenceActif({
      agentId,
      actionClass,
      delegationId,
    });

    const params: ParametresPlafondAutonomie = {
      agent,
      agentId,
      action,
      scope,
      permissions,
      delegation,
      montantDemande,
      riskLevel,
      evidenceQuality,
      emergencyStopActif,
      requestedAutonomyLevel,
    };

    // Le SEUL moteur d'évaluation — jamais dupliqué, jamais réimplémenté.
    const evaluation = calculerPlafondAutonomie(params);

    return NextResponse.json({
      correlationId,
      agentId,
      action: action ?? null,
      scope: scope ?? null,
      requestedAutonomy: evaluation.requestedAutonomy,
      autonomyCeiling: evaluation.autonomyCeiling,
      humanNecessity: evaluation.humanNecessity,
      blocked: evaluation.blocked,
      allowedForEvaluation: evaluation.allowedForEvaluation,
      reasons: evaluation.reasons,
      applicableConstraints: evaluation.applicableConstraints,
    });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de l'évaluation du plafond d'autonomie." }, { status: 500 });
  }
}
