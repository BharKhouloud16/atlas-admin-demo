import { test, expect } from "@playwright/test";
import { validerContenuMessage, CONTENU_MESSAGE_MAX } from "@/lib/client-messages";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
// Fonction pure : jamais un message vide, jamais une taille illimitée —
// aucun accès DB ici, voir tests/api/c8-client-communication.spec.ts pour
// le comportement HTTP/sécurité.

test.describe("COMPANY ATLAS C8 — validerContenuMessage", () => {
  test("contenu valide -> renvoyé nettoyé (trim)", () => {
    expect(validerContenuMessage("  Bonjour, une question sur ma mission.  ")).toBe("Bonjour, une question sur ma mission.");
  });

  test("chaîne vide -> null", () => {
    expect(validerContenuMessage("")).toBeNull();
  });

  test("uniquement des espaces -> null", () => {
    expect(validerContenuMessage("   ")).toBeNull();
  });

  test("type non-string -> null (jamais un crash sur une entrée malformée)", () => {
    expect(validerContenuMessage(null)).toBeNull();
    expect(validerContenuMessage(undefined)).toBeNull();
    expect(validerContenuMessage(42)).toBeNull();
    expect(validerContenuMessage({ contenu: "x" })).toBeNull();
  });

  test(`exactement ${CONTENU_MESSAGE_MAX} caractères -> accepté`, () => {
    const contenu = "a".repeat(CONTENU_MESSAGE_MAX);
    expect(validerContenuMessage(contenu)).toBe(contenu);
  });

  test(`${CONTENU_MESSAGE_MAX + 1} caractères -> refusé, jamais tronqué silencieusement`, () => {
    const contenu = "a".repeat(CONTENU_MESSAGE_MAX + 1);
    expect(validerContenuMessage(contenu)).toBeNull();
  });
});
