import { test, expect } from "@playwright/test";
import { estDelegationCouvrante } from "@/lib/control-plane/delegations";
import type { AgentPermission } from "@/lib/agents/permissions";

// COMPANY ATLAS — B22 : fonction pure estDelegationCouvrante.
// NULL sur maxAmount/maxRiskLevel = aucune couverture de cette dimension,
// JAMAIS "illimité" (Phase 3-FIX, point 1). Aucun accès base de données ici.

function permissionActive(overrides: Partial<AgentPermission> = {}): AgentPermission {
  return {
    id: "perm-1",
    agentId: "agent-1",
    action: "EXECUTE",
    scope: "COMPANY_OS",
    statut: "ACTIVE",
    ...overrides,
  } as AgentPermission;
}

function delegationActive(overrides: Partial<Parameters<typeof estDelegationCouvrante>[0]> = {}) {
  return {
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    action: "EXECUTE" as const,
    scope: "COMPANY_OS" as const,
    maxAmount: null,
    maxRiskLevel: null,
    ...overrides,
  };
}

test.describe("COMPANY ATLAS B22 — Delegation (estDelegationCouvrante)", () => {
  test("maxAmount NULL ne couvre jamais un montant demandé — NULL != illimité", () => {
    const resultat = estDelegationCouvrante(delegationActive({ maxAmount: null }), [permissionActive()], "agent-1", {
      action: "EXECUTE",
      scope: "COMPANY_OS",
      montantDemande: 1,
    });
    expect(resultat.couvre).toBe(false);
    expect(resultat.montantDepasse).toBe(true);
  });

  test("maxRiskLevel NULL ne couvre jamais un risque demandé — NULL != illimité", () => {
    const resultat = estDelegationCouvrante(delegationActive({ maxRiskLevel: null }), [permissionActive()], "agent-1", {
      action: "EXECUTE",
      scope: "COMPANY_OS",
      risqueDemande: "LOW",
    });
    expect(resultat.couvre).toBe(false);
    expect(resultat.risqueDepasse).toBe(true);
  });

  test("montant demandé strictement supérieur à maxAmount -> non couvert", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ maxAmount: 1000 }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS", montantDemande: 1000.01 }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.montantDepasse).toBe(true);
  });

  test("montant demandé égal ou inférieur à maxAmount -> couvert", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ maxAmount: 1000 }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS", montantDemande: 1000 }
    );
    expect(resultat.couvre).toBe(true);
    expect(resultat.montantDepasse).toBe(false);
  });

  test("risque demandé strictement supérieur à maxRiskLevel -> non couvert", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ maxRiskLevel: "MEDIUM" }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS", risqueDemande: "HIGH" }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.risqueDepasse).toBe(true);
  });

  test("risque demandé au niveau ou en dessous de maxRiskLevel -> couvert", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ maxRiskLevel: "HIGH" }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS", risqueDemande: "MEDIUM" }
    );
    expect(resultat.couvre).toBe(true);
    expect(resultat.risqueDepasse).toBe(false);
  });

  test("Delegation expirée -> jamais couvrante, quel que soit le reste", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ expiresAt: new Date(Date.now() - 1000), maxAmount: 999999 }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS" }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.raison).toContain("expirée");
  });

  test("Delegation révoquée (status != ACTIVE) -> jamais couvrante", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ status: "REVOKED" }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS" }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.raison).toContain("évoquée");
  });

  test("action/scope demandés différents de la Delegation -> jamais couvrante", () => {
    const resultat = estDelegationCouvrante(delegationActive(), [permissionActive()], "agent-1", {
      action: "EXECUTE",
      scope: "TALENT",
    });
    expect(resultat.couvre).toBe(false);
    expect(resultat.raison).toContain("scope");
  });

  test("AgentPermission sous-jacente désactivée depuis l'octroi -> jamais couvrante", () => {
    const resultat = estDelegationCouvrante(
      delegationActive(),
      [permissionActive({ statut: "DISABLED" })],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS" }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.raison).toContain("désactivée");
  });

  test("cas nominal : Delegation active, non expirée, permission active, aucun plafond dépassé -> couvert", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ maxAmount: 5000, maxRiskLevel: "HIGH" }),
      [permissionActive()],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS", montantDemande: 100, risqueDemande: "LOW" }
    );
    expect(resultat.couvre).toBe(true);
    expect(resultat.montantDepasse).toBe(false);
    expect(resultat.risqueDepasse).toBe(false);
  });

  test("aucun montant/risque demandé (contexte sans engagement financier ni risque déclaré) -> couvert si le reste est valide", () => {
    const resultat = estDelegationCouvrante(delegationActive(), [permissionActive()], "agent-1", {
      action: "EXECUTE",
      scope: "COMPANY_OS",
    });
    expect(resultat.couvre).toBe(true);
  });

  // B23-FIX1 (audit humain PR #9, correction P0) : AgentPermission ACTIVE
  // pour le même agentId+action mais un AUTRE scope que la Delegation ne
  // doit jamais être confondue avec la permission qui l'a réellement
  // autorisée. Avant cette correction, possedePermissionActive() ne
  // vérifiait qu'agentId+action, donc cette permission TALENT aurait
  // masqué la désactivation réelle de PROPOSE/COMPANY_OS.
  test("AgentPermission active existe mais pour un AUTRE scope que la Delegation -> jamais couvrante (scope exact requis)", () => {
    const resultat = estDelegationCouvrante(
      delegationActive({ scope: "COMPANY_OS" }),
      [permissionActive({ scope: "TALENT" })],
      "agent-1",
      { action: "EXECUTE", scope: "COMPANY_OS" }
    );
    expect(resultat.couvre).toBe(false);
    expect(resultat.raison).toContain("désactivée");
  });
});
