import { test, expect } from "@playwright/test";
import {
  AGENT_PERMISSION_ACTIONS,
  AGENT_PERMISSION_SCOPES,
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  estPermissionActive,
  possedePermissionActive,
} from "@/lib/agents/permissions";

// COMPANY ATLAS — B20 : fonctions pures du Permission Registry
// (lib/agents/permissions.ts). Aucun accès base de données ici — voir
// tests/api/b20-permission-registry.spec.ts pour le chemin API/DB complet.

test.describe("COMPANY ATLAS B20 — Permission Registry (fonctions pures)", () => {
  test("AGENT_PERMISSION_ACTIONS est le vocabulaire fermé exact (6 actions), jamais une action inventée", () => {
    expect(AGENT_PERMISSION_ACTIONS).toEqual(["READ", "WRITE", "EXECUTE", "PROPOSE", "REPORT", "ANALYZE"]);
  });

  test("AGENT_PERMISSION_SCOPES est le vocabulaire fermé exact (4 périmètres), aucun scope ALL/GLOBAL", () => {
    expect(AGENT_PERMISSION_SCOPES).toEqual(["TALENT", "SECURITY", "COMPANY_OS", "PRINCIPAL"]);
    expect(AGENT_PERMISSION_SCOPES.some((s) => /all|global|super|\*/i.test(s))).toBe(false);
  });

  test("estAgentPermissionActionValide accepte les 6 actions officielles, rejette tout le reste", () => {
    for (const action of AGENT_PERMISSION_ACTIONS) {
      expect(estAgentPermissionActionValide(action)).toBe(true);
    }
    expect(estAgentPermissionActionValide("DELETE")).toBe(false);
    expect(estAgentPermissionActionValide("")).toBe(false);
    expect(estAgentPermissionActionValide(null)).toBe(false);
    expect(estAgentPermissionActionValide(undefined)).toBe(false);
    expect(estAgentPermissionActionValide(1)).toBe(false);
  });

  test("estAgentPermissionScopeValide accepte les 4 périmètres officiels, rejette tout le reste (dont ALL/GLOBAL)", () => {
    for (const scope of AGENT_PERMISSION_SCOPES) {
      expect(estAgentPermissionScopeValide(scope)).toBe(true);
    }
    expect(estAgentPermissionScopeValide("ALL")).toBe(false);
    expect(estAgentPermissionScopeValide("GLOBAL")).toBe(false);
    expect(estAgentPermissionScopeValide("")).toBe(false);
    expect(estAgentPermissionScopeValide(null)).toBe(false);
  });

  test("estPermissionActive : ACTIVE est actif, DISABLED ne l'est jamais", () => {
    expect(estPermissionActive({ statut: "ACTIVE" })).toBe(true);
    expect(estPermissionActive({ statut: "DISABLED" })).toBe(false);
  });

  // B21.1 — M1 : garde-fou consommé par lib/strategic/propositions.ts pour
  // vérifier qu'un agent a la permission PROPOSE avant de créer une
  // StrategicActionProposal en son nom. Toujours des permissions
  // synthétiques ici (aucun accès base de données) — voir
  // tests/api/b21-strategic-foundation.spec.ts pour le chemin API/DB
  // complet, y compris le cas PROPOSE DISABLED, impossible à obtenir avec
  // les seules 2 permissions PROPOSE réellement seedées (toutes deux
  // ACTIVE, B21.1).
  test("possedePermissionActive : autorise seulement une permission ACTIVE pour l'action et l'agent exacts", () => {
    const permissions = [
      { agentId: "agent-atlas-talent", action: "PROPOSE" as const, statut: "ACTIVE" as const },
      { agentId: "agent-atlas-os-services", action: "PROPOSE" as const, statut: "ACTIVE" as const },
      { agentId: "agent-atlas-talent", action: "READ" as const, statut: "ACTIVE" as const },
    ];

    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE")).toBe(true);
    expect(possedePermissionActive(permissions, "agent-atlas-os-services", "PROPOSE")).toBe(true);
  });

  test("possedePermissionActive : refuse un agent sans permission pour cette action (aucune permission implicite)", () => {
    const permissions = [{ agentId: "agent-atlas-talent", action: "PROPOSE" as const, statut: "ACTIVE" as const }];

    expect(possedePermissionActive(permissions, "agent-principal", "PROPOSE")).toBe(false);
    expect(possedePermissionActive(permissions, "agent-company-os", "PROPOSE")).toBe(false);
    expect(possedePermissionActive([], "agent-atlas-talent", "PROPOSE")).toBe(false);
  });

  test("possedePermissionActive : refuse une permission DISABLED, même si l'action et l'agent correspondent", () => {
    const permissions = [{ agentId: "agent-atlas-talent", action: "PROPOSE" as const, statut: "DISABLED" as const }];
    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE")).toBe(false);
  });

  test("possedePermissionActive : refuse une permission ACTIVE mais pour une autre action (READ n'implique jamais PROPOSE)", () => {
    const permissions = [{ agentId: "agent-atlas-talent", action: "READ" as const, statut: "ACTIVE" as const }];
    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE")).toBe(false);
  });

  // B23-FIX1 (audit humain PR #9, correction P0) : le modèle COMPANY ATLAS
  // est agentId+action+SCOPE+ACTIVE — le 4e argument optionnel `scope`
  // rend cette correspondance stricte. Sans lui (3 arguments), le
  // comportement ci-dessus reste inchangé (rétrocompatibilité vérifiée par
  // les tests précédents) ; avec lui, une permission active pour un AUTRE
  // scope ne doit jamais être considérée comme une autorisation.
  test("possedePermissionActive (4e argument scope) : PROPOSE+TALENT ACTIVE n'autorise jamais PROPOSE+SECURITY", () => {
    const permissions = [
      { agentId: "agent-atlas-talent", action: "PROPOSE" as const, scope: "TALENT" as const, statut: "ACTIVE" as const },
    ];
    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE", "TALENT")).toBe(true);
    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE", "SECURITY")).toBe(false);
  });

  test("possedePermissionActive (4e argument scope) : refuse une permission DISABLED même avec un scope exact", () => {
    const permissions = [
      { agentId: "agent-atlas-talent", action: "PROPOSE" as const, scope: "TALENT" as const, statut: "DISABLED" as const },
    ];
    expect(possedePermissionActive(permissions, "agent-atlas-talent", "PROPOSE", "TALENT")).toBe(false);
  });
});
