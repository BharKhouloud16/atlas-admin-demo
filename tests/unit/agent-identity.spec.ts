import { test, expect } from "@playwright/test";
import { AGENTS_OFFICIELS, estAgentOfficielValide, estAgentActif } from "@/lib/agents/identity";

// COMPANY ATLAS — B19 : fonctions pures du registre Agent Identity
// (lib/agents/identity.ts). Aucun accès base de données ici — voir
// tests/api/b19-agent-identity.spec.ts pour le chemin API/DB complet.

test.describe("COMPANY ATLAS B19 — Agent Identity (fonctions pures)", () => {
  test("AGENTS_OFFICIELS contient exactement les 4 agents de l'architecture officielle, jamais un 5e", () => {
    expect(AGENTS_OFFICIELS).toEqual(["PRINCIPAL", "ATLAS_TALENT", "ATLAS_OS_SERVICES", "COMPANY_OS"]);
    expect(AGENTS_OFFICIELS.length).toBe(4);
  });

  test("estAgentOfficielValide accepte les 4 agents officiels, rejette tout le reste", () => {
    for (const agent of AGENTS_OFFICIELS) {
      expect(estAgentOfficielValide(agent)).toBe(true);
    }
    expect(estAgentOfficielValide("ATLAS_AUTRE_INVENTE")).toBe(false);
    expect(estAgentOfficielValide("admin")).toBe(false);
    expect(estAgentOfficielValide("")).toBe(false);
    expect(estAgentOfficielValide(null)).toBe(false);
    expect(estAgentOfficielValide(undefined)).toBe(false);
    expect(estAgentOfficielValide(42)).toBe(false);
  });

  test("estAgentActif : ACTIVE est actif, DISABLED ne l'est jamais (Charte/B19 Phase 6)", () => {
    expect(estAgentActif({ statut: "ACTIVE" })).toBe(true);
    expect(estAgentActif({ statut: "DISABLED" })).toBe(false);
  });
});
