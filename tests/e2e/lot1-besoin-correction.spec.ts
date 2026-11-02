import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 1 (28/10/2026) — parcours Client réel sur un besoin :
//   ANO-04 : les trois compétences enregistrées sont toutes affichées ;
//   ANO-03 : une valeur comprise par ATLAS (budget lu « 2027 ») est
//            présentée comme « Compris par ATLAS » et se corrige ;
//   ANO-05 : la correction apparaît immédiatement, sans recharger la page.
// REV-03 (01/11/2026) : client isolé, propre au test.

test("compétences toutes visibles, budget corrigé et affiché sans rechargement", async ({ page }) => {
  const { client, email } = await creerClientIsole();
  const suffixe = `${Date.now()}`;
  const titre = `Besoin lot1 e2e ${suffixe}`;
  await prisma.clientNeed.create({
    data: {
      clientId: client.id,
      correlationId: `lot1-e2e-${suffixe}`,
      titre,
      texteOriginal: `${titre} : QA senior, Playwright, TypeScript, Postman, budget 550 EUR par jour, janvier 2027.`,
      statut: "SOUMIS",
      faits: {
        create: [
          { cle: "COMPETENCE", valeur: "Playwright", statut: "DECLARE", source: "extraction" },
          { cle: "COMPETENCE", valeur: "JavaScript / TypeScript", statut: "DECLARE", source: "extraction" },
          { cle: "COMPETENCE", valeur: "Postman", statut: "DECLARE", source: "extraction" },
          { cle: "BUDGET_MONTANT", valeur: "2027", statut: "DECLARE", source: "extraction" },
        ],
      },
    },
  });

  await connecterPage(page, email);
  await page.goto("/client/besoins");
  await page.getByText(titre, { exact: true }).click();

  for (const competence of ["Playwright", "JavaScript / TypeScript", "Postman"]) {
    await expect(page.getByRole("button", { name: `Retirer la compétence ${competence}` })).toBeVisible();
  }
  await expect(page.getByText("Compris par ATLAS").first()).toBeVisible();

  let requetesListe = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/client/besoins") requetesListe++;
  });

  await page.getByRole("button", { name: "Corriger : Budget" }).click();
  await page.getByLabel("Nouvelle valeur pour Budget").fill("550");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Corrigé par vous").first()).toBeVisible();
  await expect(page.locator("strong", { hasText: /^550$/ })).toBeVisible();
  await expect(page.locator("strong", { hasText: /^2027$/ })).toHaveCount(0);
  // La carte a été mise à jour depuis la réponse de la correction, sans
  // nouveau chargement de la liste ni de la page.
  expect(requetesListe).toBe(0);
});
