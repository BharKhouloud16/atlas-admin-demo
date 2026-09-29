import { test, expect } from "@playwright/test";
import { exigerSecret, secretCourant } from "@/lib/session-secret";

// ATLAS LOT 12.1 — SECURITY HARDENING (29/09/2026).
//
// Avant ce lot, un SESSION_SECRET absent/vide/whitespace ne provoquait
// aucune erreur : TextEncoder.encode(undefined) retombe silencieusement sur
// une clé de longueur zéro (le paramètre WebIDL par défaut s'applique), et
// l'application signait/vérifiait quand même des sessions avec une clé HMAC
// vide — un secret de fait absent, jamais un échec explicite. exigerSecret()
// (extraite de lib/session-secret.ts) est la garde qui remplace ce
// comportement par un échec systématique et explicite, sans jamais accepter
// de valeur par défaut ni de fallback silencieux.

test.describe("Lot 12.1 — SESSION_SECRET obligatoire (exigerSecret)", () => {
  test("1. secret présent -> fonctionnement normal, valeur retournée telle quelle", () => {
    expect(exigerSecret("une-vraie-valeur-secrete", "SESSION_SECRET")).toBe("une-vraie-valeur-secrete");
  });

  test("2. secret absent (undefined) -> échec explicite", () => {
    expect(() => exigerSecret(undefined, "SESSION_SECRET")).toThrow(/SESSION_SECRET/);
  });

  test("3. secret vide (chaîne vide) -> échec explicite", () => {
    expect(() => exigerSecret("", "SESSION_SECRET")).toThrow(/SESSION_SECRET/);
  });

  test("4. secret whitespace uniquement -> échec explicite, jamais accepté comme une vraie valeur", () => {
    expect(() => exigerSecret("   ", "SESSION_SECRET")).toThrow(/SESSION_SECRET/);
    expect(() => exigerSecret("\t\n  ", "SESSION_SECRET")).toThrow(/SESSION_SECRET/);
  });

  test("5. le message d'erreur ne contient jamais la valeur du secret, seulement le nom de la variable", () => {
    try {
      exigerSecret("", "SESSION_SECRET_PREVIOUS");
      throw new Error("aurait dû lever une erreur");
    } catch (e: any) {
      expect(e.message).toContain("SESSION_SECRET_PREVIOUS");
      expect(e.message).not.toContain("undefined");
    }
  });

  test("6. secretCourant (déjà chargé au démarrage avec le SESSION_SECRET réel de l'environnement) est une clé non vide", () => {
    // SESSION_SECRET est nécessairement défini dans cet environnement — sinon
    // le module lui-même n'aurait jamais pu être importé (la garde aurait
    // déjà levé une exception au chargement, avant ce test).
    expect(secretCourant.length).toBeGreaterThan(0);
  });
});
