import { test, expect } from "@playwright/test";
import {
  AGENT_PERMISSION_ACTIONS,
  AGENT_PERMISSION_SCOPES,
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  estPermissionActive,
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
});
