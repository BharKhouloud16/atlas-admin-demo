import { test, expect } from "@playwright/test";
import { estAutoAutorisationInterdite, peutExecuter } from "@/lib/strategic/propositions";

// COMPANY ATLAS — B21 : garde-fous purs de lib/strategic/propositions.ts.
// Ce fichier vérifie spécifiquement la règle absolue de la directive B21
// "ne jamais s'auto-autoriser" au niveau de la fonction pure — la garantie
// structurelle complète (autorisateurEmail dérivé de la session serveur,
// jamais du corps de la requête) est vérifiée côté API, voir
// tests/api/b21-strategic-foundation.spec.ts.

test.describe("COMPANY ATLAS B21 — jamais d'auto-autorisation (fonctions pures)", () => {
  test("estAutoAutorisationInterdite refuse un autorisateur vide", () => {
    expect(estAutoAutorisationInterdite({ autorisateurEmail: "", agentIdProposant: "agent-atlas-talent" })).toBe(true);
    expect(estAutoAutorisationInterdite({ autorisateurEmail: "   ", agentIdProposant: "agent-atlas-talent" })).toBe(true);
  });

  test("estAutoAutorisationInterdite refuse un autorisateur identique à l'agent proposant", () => {
    expect(
      estAutoAutorisationInterdite({ autorisateurEmail: "agent-atlas-talent", agentIdProposant: "agent-atlas-talent" })
    ).toBe(true);
    // insensible à la casse/espaces — défense en profondeur
    expect(
      estAutoAutorisationInterdite({ autorisateurEmail: "  Agent-Atlas-Talent  ", agentIdProposant: "agent-atlas-talent" })
    ).toBe(true);
  });

  test("estAutoAutorisationInterdite accepte un autorisateur humain distinct de l'agent proposant", () => {
    expect(
      estAutoAutorisationInterdite({ autorisateurEmail: "admin-demo@example.com", agentIdProposant: "agent-atlas-talent" })
    ).toBe(false);
  });

  test("peutExecuter n'autorise EXECUTEE que depuis le statut AUTORISEE — jamais depuis PROPOSEE ou REFUSEE", () => {
    expect(peutExecuter({ statut: "AUTORISEE" })).toBe(true);
    expect(peutExecuter({ statut: "PROPOSEE" })).toBe(false);
    expect(peutExecuter({ statut: "AUTORISATION_DEMANDEE" })).toBe(false);
    expect(peutExecuter({ statut: "REFUSEE" })).toBe(false);
    expect(peutExecuter({ statut: "EXECUTEE" })).toBe(false);
    expect(peutExecuter({ statut: "CONTROLEE" })).toBe(false);
  });
});
