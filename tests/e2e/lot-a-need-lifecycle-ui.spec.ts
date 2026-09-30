import { test, expect } from "@playwright/test";
import { CLIENT_STATE } from "../setup/storage-state";

// ATLAS — LOT A : Need Lifecycle canonique (A2) — volet UI.
//
// Couvre uniquement ce que les tests API ne peuvent pas vérifier : le
// nouveau libellé de vocabulaire canonique (app/client/besoins/page.tsx)
// est bien rendu à l'écran, en complément — jamais à la place — du libellé
// existant (dual-read, gate A0 §9). Le parcours fonctionnel complet
// (création -> facts -> transitions -> validation -> IDOR) est déjà
// couvert par tests/api/lot-a-need-lifecycle-versioning.spec.ts, via les
// mêmes routes réelles ; pas dupliqué ici.
//
// Les points explicitement STOP de ce lot (modification post-validation
// créant une nouvelle version, consultation de l'historique de versions)
// ne sont pas testés ici — ce comportement n'est pas implémenté (voir
// rapport final, section "Points STOP").

test.describe("Client — /client/besoins — vocabulaire canonique du Need Lifecycle", () => {
  test.use({ storageState: CLIENT_STATE });

  test("un besoin nouvellement créé affiche à la fois l'ancien libellé et le nouveau (UNDERSTANDING)", async ({ page }) => {
    await page.goto("/client/besoins");
    await expect(page.getByRole("heading", { name: /besoins/i })).toBeVisible();

    const texte = `LOT A E2E — besoin de test ${Date.now()} — développeur QA automation senior`;
    await page.getByPlaceholder(/nous cherchons deux qa automation/i).fill(texte);
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();

    await expect(page.getByText(texte.slice(0, 40))).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Soumis", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Compréhension en cours", { exact: true }).first()).toBeVisible();
  });
});
