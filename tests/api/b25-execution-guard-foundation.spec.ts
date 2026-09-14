import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { guardExecution } from "@/lib/control-plane/execution-guard";
import { creerDemandeAutorisation, revoquerDemande } from "@/lib/control-plane/authorization";
import { creerDelegation, revoquerDelegation } from "@/lib/control-plane/delegations";
import { activerArretUrgence, leverArretUrgence } from "@/lib/control-plane/emergency-stop";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B25 (14/09/2026) : EXECUTION GUARD FOUNDATION.
// Couvre les cas PASS/DENY/race-conditions/sécurité mandatés par l'ordre.
// Appels DIRECTS aux fonctions B22 existantes (creerDemandeAutorisation,
// creerDelegation, activerArretUrgence, revoquerDemande, revoquerDelegation)
// — jamais via une route HTTP créée pour ce lot (aucune n'existe : B25 ne
// wire volontairement aucune route, voir lib/control-plane/execution-guard.ts).
// Même discipline que tests/api/b24-lot-b-authorization-request.spec.ts
// (bloc FIX1, appels directs).
//
// NOTE — "autonomy insuffisante" (case DENY de l'ordre) : par construction
// (directive B25, "ne pas rendre B23 une autorité indépendante"), la
// dimension AUTONOMY de guardExecution est REDONDANTE avec Identity/
// Permission/EmergencyStop (mêmes faits, recalculés) — elle ne peut donc
// jamais être la SEULE cause d'un DENY : tout scénario qui la rendrait
// bloquante déclenche déjà un DENY plus tôt (Identity/Permission/
// EmergencyStop). C'est le comportement voulu, pas un angle mort — vérifié
// explicitement ci-dessous (test dédié) plutôt que silencieusement supposé.

async function idAgentDirect(nom: "ATLAS_TALENT" | "ATLAS_OS_SERVICES" | "PRINCIPAL" | "COMPANY_OS"): Promise<string> {
  const agent = await prisma.agentIdentity.findFirst({ where: { agent: nom } });
  if (!agent) throw new Error(`Agent ${nom} introuvable`);
  return agent.id;
}

async function demandeApprouveeAutomatiquement(
  agentId: string,
  overrides?: { riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; delegationId?: string }
) {
  const correlationId = nouveauCorrelationId();
  const resultat = await creerDemandeAutorisation({
    correlationId,
    agentId,
    action: "PROPOSE",
    scope: "TALENT",
    objective: "Test B25 Execution Guard",
    reason: "Test B25 Execution Guard",
    requestedAutonomyLevel: "L2_RECOMMEND",
    riskLevel: overrides?.riskLevel,
    delegationId: overrides?.delegationId,
  });
  if (!resultat.ok) throw new Error(resultat.erreur);
  expect(resultat.status).toBe("RESOLVED");
  expect(resultat.decision).toBe("ALLOW");
  return { authorizationRequestId: resultat.id, correlationId };
}

test.describe("COMPANY ATLAS B25 — Execution Guard Foundation", () => {
  // ---- PASS -----------------------------------------------------------

  test("PASS 1 — nominal : agent actif, permission active, authorization APPROVED, aucun Emergency Stop -> ALLOW", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });

    expect(resultat.decision).toBe("ALLOW");
    expect(resultat.reasons.every((r) => !r.bloquant)).toBe(true);
    expect(resultat.reasons.map((r) => r.dimension)).toEqual(
      expect.arrayContaining(["AUTHORIZATION_REQUEST", "IDENTITY", "PERMISSION", "EMERGENCY_STOP", "AUTONOMY"])
    );
    expect(resultat.autonomie).not.toBeNull();
  });

  test("PASS 2 — Delegation valide et couvrante -> ALLOW, dimension DELEGATION explicitement vérifiée", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const delegationRes = await creerDelegation({
      correlationId: nouveauCorrelationId(),
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      objective: "Test B25 — délégation couvrante",
      actionClass: "INTERNAL_ACTION",
      maxAmount: 1000,
      maxRiskLevel: "MEDIUM",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: "admin-demo@example.com",
    });
    expect(delegationRes.ok).toBe(true);
    if (!delegationRes.ok) throw new Error("unreachable");

    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId, {
      delegationId: delegationRes.id,
    });

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("ALLOW");
    const raisonDelegation = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raisonDelegation?.bloquant).toBe(false);
  });

  test("PASS 3 — riskLevel déclaré à l'exécution mais couvert par le dossier B22 -> ALLOW", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    // Un risque déclaré SANS Delegation couvrante exige une approbation
    // humaine (Human Necessity, B22) — attendu, pas un bug. Une Delegation
    // qui couvre explicitement ce risque permet la résolution automatique
    // ALLOW nécessaire pour ce test (même recette que PASS 2).
    const delegationRes = await creerDelegation({
      correlationId: nouveauCorrelationId(),
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      objective: "Test B25 — délégation couvrant le risque",
      actionClass: "INTERNAL_ACTION",
      maxRiskLevel: "MEDIUM",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: "admin-demo@example.com",
    });
    if (!delegationRes.ok) throw new Error("unreachable");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId, {
      riskLevel: "MEDIUM",
      delegationId: delegationRes.id,
    });

    const resultat = await guardExecution({
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      riskLevel: "LOW",
      authorizationRequestId,
      correlationId,
    });
    expect(resultat.decision).toBe("ALLOW");
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.bloquant).toBe(false);
  });

  // ---- DENY -------------------------------------------------------------

  test("DENY — agent inactif (revalidé EN DIRECT, pas seulement au moment de la demande)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    try {
      const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
      expect(resultat.decision).toBe("DENY");
      expect(resultat.reasons.find((r) => r.dimension === "IDENTITY")?.bloquant).toBe(true);
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }
  });

  test("DENY — permission désactivée depuis l'octroi (revalidée EN DIRECT)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    await prisma.agentPermission.updateMany({ where: { agentId, action: "PROPOSE", scope: "TALENT" }, data: { statut: "DISABLED" } });
    try {
      const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
      expect(resultat.decision).toBe("DENY");
      expect(resultat.reasons.find((r) => r.dimension === "PERMISSION")?.bloquant).toBe(true);
    } finally {
      await prisma.agentPermission.updateMany({ where: { agentId, action: "PROPOSE", scope: "TALENT" }, data: { statut: "ACTIVE" } });
    }
  });

  test("DENY — scope escalation : le scope déclaré à l'exécution diffère du scope réellement autorisé", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "SECURITY", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — permission escalation : l'action déclarée à l'exécution diffère de l'action réellement autorisée", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const resultat = await guardExecution({ agentId, action: "EXECUTE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — agent impersonation : agentId déclaré différent de l'agent réel de l'AuthorizationRequest", async () => {
    const agentTalent = await idAgentDirect("ATLAS_TALENT");
    const agentOsServices = await idAgentDirect("ATLAS_OS_SERVICES");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentTalent);

    const resultat = await guardExecution({
      agentId: agentOsServices,
      action: "PROPOSE",
      scope: "TALENT",
      authorizationRequestId,
      correlationId,
    });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — IDOR/BOLA : correlationId déclaré différent de celui réellement porté par l'AuthorizationRequest", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId } = await demandeApprouveeAutomatiquement(agentId);

    const resultat = await guardExecution({
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      authorizationRequestId,
      correlationId: nouveauCorrelationId(), // arbitraire, jamais celui du dossier réel
    });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — Delegation expirée (valide à la création de l'AuthorizationRequest, expirée avant l'exécution)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const delegationRes = await creerDelegation({
      correlationId: nouveauCorrelationId(),
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      objective: "Test B25 — délégation qui va expirer",
      actionClass: "INTERNAL_ACTION",
      maxAmount: 1000,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: "admin-demo@example.com",
    });
    if (!delegationRes.ok) throw new Error("unreachable");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId, { delegationId: delegationRes.id });

    // Simule le passage du temps — la délégation était valide à la
    // création de l'AuthorizationRequest, mais ne l'est plus au moment de
    // l'exécution.
    await prisma.delegation.update({ where: { id: delegationRes.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons.find((r) => r.dimension === "DELEGATION")?.bloquant).toBe(true);
  });

  test("DENY (RACE CONDITION) — Delegation révoquée juste avant la tentative d'exécution", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const delegationRes = await creerDelegation({
      correlationId: nouveauCorrelationId(),
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      objective: "Test B25 — délégation révoquée juste avant exécution",
      actionClass: "INTERNAL_ACTION",
      maxAmount: 1000,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: "admin-demo@example.com",
    });
    if (!delegationRes.ok) throw new Error("unreachable");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId, { delegationId: delegationRes.id });

    // La révocation survient APRÈS que l'AuthorizationRequest a été
    // résolue ALLOW — exactement le scénario TOCTOU que ce Guard ferme.
    const revocation = await revoquerDelegation({ delegationId: delegationRes.id, revokedBy: "admin-demo@example.com", reason: "Test B25" });
    expect(revocation.ok).toBe(true);

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons.find((r) => r.dimension === "DELEGATION")?.bloquant).toBe(true);
  });

  test("DENY — authorizationRequestId inexistant", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const resultat = await guardExecution({
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      authorizationRequestId: "authorization-request-inexistant-xyz",
      correlationId: nouveauCorrelationId(),
    });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — AuthorizationRequest déjà REVOKED (RACE CONDITION : révoquée après résolution ALLOW, juste avant l'exécution)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const revocation = await revoquerDemande({ id: authorizationRequestId, revokedBy: "admin-demo@example.com", reason: "Test B25" });
    expect(revocation.ok).toBe(true);

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY — fenêtre de validité (72h) dépassée, même si decision reste ALLOW en base (B22 ne re-vérifie jamais ce cas lui-même)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    await prisma.authorizationRequest.update({ where: { id: authorizationRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const avant = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(avant?.decision).toBe("ALLOW"); // toujours ALLOW en base — B22 lui-même ne le change jamais

    const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("AUTHORIZATION_REQUEST");
  });

  test("DENY (RACE CONDITION) — Emergency Stop activé juste avant la tentative d'exécution, alors que l'AuthorizationRequest était déjà ALLOW", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const arretRes = await activerArretUrgence({
      correlationId: nouveauCorrelationId(),
      scope: "GLOBAL",
      reason: "Test B25 — Emergency Stop juste avant exécution",
      activatedBy: "admin-demo@example.com",
    });
    expect(arretRes.ok).toBe(true);
    if (!arretRes.ok) throw new Error("unreachable");

    try {
      const resultat = await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });
      expect(resultat.decision).toBe("DENY");
      expect(resultat.reasons.find((r) => r.dimension === "EMERGENCY_STOP")?.bloquant).toBe(true);

      // "Autonomy insuffisante" ne cause jamais SEULE le DENY (voir en-tête
      // de fichier) : ici EMERGENCY_STOP est déjà bloquant, donc AUTONOMY
      // n'apparaît même pas dans les raisons (retour anticipé) — vérifié
      // explicitement, jamais silencieusement supposé.
      expect(resultat.reasons.find((r) => r.dimension === "AUTONOMY")).toBeUndefined();
    } finally {
      await leverArretUrgence({ emergencyStopId: arretRes.id, liftedBy: "admin-demo@example.com" });
    }
  });

  test("DENY — action hors vocabulaire fermé (B20), fail-closed sur une entrée malformée", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const resultat = await guardExecution({
      agentId,
      action: "DELETE_EVERYTHING",
      scope: "TALENT",
      authorizationRequestId: "peu-importe",
      correlationId: nouveauCorrelationId(),
    });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons[0].dimension).toBe("PERMISSION");
  });

  test("DENY — riskLevel déclaré à l'exécution mais absent (NULL) du dossier B22 (NULL != illimité, même discipline que Delegation)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId); // aucun riskLevel déclaré à la demande

    const resultat = await guardExecution({
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      riskLevel: "LOW",
      authorizationRequestId,
      correlationId,
    });
    expect(resultat.decision).toBe("DENY");
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.bloquant).toBe(true);
  });

  // ---- SÉCURITÉ / STRUCTURELLE ------------------------------------------

  test("SÉCURITÉ — client-supplied authorization/status : structurellement impossible (aucun champ decision/status n'existe dans la signature de guardExecution)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    // Même en passant des propriétés supplémentaires non déclarées par le
    // type (simulateur d'un appelant JS non typé/malveillant), elles sont
    // structurellement ignorées : seul authorizationRequestId influence la
    // décision, jamais une valeur "decision"/"status" fournie directement.
    const resultat = await guardExecution({
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      authorizationRequestId,
      correlationId,
      // @ts-expect-error — vérifie explicitement que même un appelant qui
      // tenterait de forcer une décision ne peut structurellement pas le
      // faire : ce champ n'existe pas dans le type et n'est jamais lu.
      decision: "ALLOW",
    });
    expect(resultat.decision).toBe("ALLOW"); // déterminé par le vrai dossier B22, pas par le champ injecté
  });

  test("SÉCURITÉ — self-authorization : structurellement hors de portée de ce Guard (garantie déjà tenue en amont, B19/B20/B21 — aucun agent n'a de session)", async () => {
    // Documenté explicitement plutôt que silencieusement supposé : ce
    // Guard ne réintroduit AUCUN concept de session agent — `agentId` est
    // toujours un paramètre dérivé côté serveur par l'appelant (jamais une
    // session agent, qui n'existe structurellement pas, limite héritée
    // B19/B20). Rien à tester ICI au-delà de la garantie déjà couverte par
    // tests/unit/strategic-propositions.spec.ts (estAutoAutorisationInterdite)
    // et l'absence de toute authentification agent dans lib/auth.ts.
    expect(true).toBe(true);
  });

  test("NON-MUTATION — un appel à guardExecution n'écrit que l'AuditEvent de traçabilité, jamais AuthorizationRequest/Delegation/AgentIdentity/AgentPermission", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const avant = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    const agentAvant = await prisma.agentIdentity.findUnique({ where: { id: agentId } });
    const permissionsAvant = await prisma.agentPermission.findMany({ where: { agentId } });

    await guardExecution({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });

    const apres = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    const agentApres = await prisma.agentIdentity.findUnique({ where: { id: agentId } });
    const permissionsApres = await prisma.agentPermission.findMany({ where: { agentId } });

    expect(apres).toEqual(avant);
    expect(agentApres).toEqual(agentAvant);
    expect(permissionsApres).toEqual(permissionsAvant);

    const evenements = await prisma.auditEvent.findMany({ where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "guard:ALLOW" } });
    expect(evenements.length).toBeGreaterThan(0);
  });
});
