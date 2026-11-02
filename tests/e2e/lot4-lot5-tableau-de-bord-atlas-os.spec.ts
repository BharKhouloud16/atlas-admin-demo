import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 4 / LOT 5 (28/10/2026) + LOT 7 (01/11/2026, planche) — tableau de bord
// rendu en un appel, lisible sur mobile ; ATLAS OS présenté comme une option
// et activé sur demande, validée par l'équipe ATLAS. Client isolé (REV-03) :
// aucun compte de démonstration modifié, aucune donnée supprimée.

test("tableau de bord : accueil, indicateurs, travail à faire, cartes ATLAS OS, veille et profil", async ({ page }) => {
  const { client, email } = await creerClientIsole({ qualification: true });
  for (const titre of ["Besoin à préciser A", "Besoin à préciser B", "Besoin à préciser C"]) {
    await prisma.clientNeed.create({ data: { clientId: client.id, correlationId: `lot4-${titre}-${client.id}`, titre, texteOriginal: `${titre} : texte de test suffisamment long.`, statut: "A_CLARIFIER" } });
  }
  await connecterPage(page, email);
  const appels: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/client/") && r.method() === "GET") appels.push(u.pathname);
  });
  await page.goto("/client");
  await expect(page.getByRole("heading", { level: 1, name: `Bonjour, ${client.nom}` })).toBeVisible();
  const indicateurs = page.getByRole("list", { name: "Indicateurs" });
  await expect(indicateurs.getByRole("listitem")).toHaveCount(6);
  await expect(indicateurs.getByText("+3 cette semaine")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Travail à faire" })).toBeVisible();
  // REV-11 : les besoins à préciser sont regroupés en une tâche qui les nomme.
  await expect(page.getByText("3 besoins à préciser")).toBeVisible();
  await expect(page.getByText(/« Besoin à préciser [ABC] », « Besoin à préciser [ABC] » et 1 autre/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activité récente" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Découvrir et activer" })).toBeVisible();
  await expect(page.getByText(/Aucune actualité n'est affichée tant que ce service n'est pas opérationnel/)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avancement du profil entreprise" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compléter mon profil" })).toBeVisible();
  // La page elle-même ne fait qu'UN appel de données (hors navigation).
  expect(appels.filter((p) => p === "/api/client/tableau-de-bord")).toHaveLength(1);
  expect(appels.filter((p) => !["/api/client/tableau-de-bord", "/api/client/attentions", "/api/client/messages"].includes(p))).toEqual([]);
});

test("tableau de bord mobile (375 px) : aucun défilement horizontal, barre d'onglets en bas", async ({ page }) => {
  const { email } = await creerClientIsole();
  await connecterPage(page, email);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/client");
  await expect(page.getByRole("heading", { name: "Travail à faire" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation rapide" })).toBeVisible();
  const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largeur).toBeLessThanOrEqual(375);
});

test("ATLAS OS : activation demandée depuis l'interface, en attente de validation", async ({ page }) => {
  const { client, email } = await creerClientIsole();
  await connecterPage(page, email);
  await page.goto("/client/atlas-os");
  const etat = page.getByRole("region", { name: "État de votre option" });
  await expect(etat.getByText("Disponible", { exact: true })).toBeVisible();
  await page.getByLabel(/Ce que vous souhaitez confier/).fill("Audit qualité de notre application mobile.");
  await page.getByRole("button", { name: "Activer ATLAS OS" }).click();
  await expect(etat.getByText("En attente de validation")).toBeVisible();
  await expect(etat.getByRole("status").filter({ hasText: "en cours d'examen" })).toBeVisible();
  expect((await prisma.activationAtlasOs.findUniqueOrThrow({ where: { clientId: client.id } })).statut).toBe("DEMANDEE");
});
