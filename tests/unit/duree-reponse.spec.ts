import { test, expect } from "@playwright/test";
import { attendreDureeMinimale, dureeMinimaleReponseMs, DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS } from "@/lib/duree-reponse";

// SÉCURITÉ — égalisation du temps de réponse (lib/duree-reponse.ts).
test.describe("Sécurité — durée plancher des réponses publiques", () => {
  test("avec fournisseur d'email : plancher actif ; sans fournisseur : aucun délai", () => {
    expect(dureeMinimaleReponseMs({ RESEND_API_KEY: "re_test" })).toBe(DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS);
    expect(dureeMinimaleReponseMs({})).toBe(0);
    expect(dureeMinimaleReponseMs({ RESEND_API_KEY: "  " })).toBe(0);
  });

  test("complète jusqu'au plancher, que le traitement ait été rapide ou plus lent", async () => {
    const env = { RESEND_API_KEY: "re_test" };
    for (const dejaEcoule of [0, 400, 1200]) {
      const debutReel = Date.now();
      // Horloge décalée : simule un traitement ayant déjà duré `dejaEcoule` ms.
      await attendreDureeMinimale(debutReel, env, () => Date.now() + dejaEcoule);
      const total = Date.now() - debutReel + dejaEcoule;
      expect(total >= DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS - 20, `${dejaEcoule} -> ${total}`).toBe(true);
      expect(total <= DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS + 200, `${dejaEcoule} -> ${total}`).toBe(true);
    }
  });

  test("traitement déjà plus long que le plancher : aucun délai ajouté", async () => {
    const debut = Date.now();
    await attendreDureeMinimale(debut, { RESEND_API_KEY: "re_test" }, () => Date.now() + 5000);
    expect(Date.now() - debut < 50).toBe(true);
  });
});
