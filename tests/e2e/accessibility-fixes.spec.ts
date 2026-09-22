import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// ATLAS — MODE AUTONOME CONTRÔLÉ — Bloc 4.4 (Accessibilité prioritaire).
//
// Couvre EXACTEMENT les 2 points localisés retenus par l'audit Design (pas
// un audit WCAG complet) :
// 1. Navigation par onglets de l'Espace Ingénieur (app/ingenieur/
//    EspaceIngenieur.tsx) — sémantique ARIA absente jusqu'ici
//    (role="tablist"/"tab"/aria-selected), contrairement à l'équivalent
//    Client (components/client/primitives.tsx, Tabs).
// 2. Carte de besoin Client (app/client/besoins/page.tsx) — un <div
//    onClick> sans affordance clavier (ni tabIndex, ni onKeyDown), donc
//    inatteignable/inactivable au clavier.

test.describe("Accessibilité — navigation Ingénieur (tablist)", () => {
  test.use({ storageState: INGENIEUR_STATE });

  test("les onglets exposent role=tablist/tab et aria-selected sur l'onglet actif ; activables au clavier", async ({ page }) => {
    await page.goto("/ingenieur");

    const tablist = page.getByRole("tablist", { name: /sections de l'espace ingénieur/i });
    await expect(tablist).toBeVisible();

    const ongletProfil = page.getByRole("tab", { name: "Profil" });
    await expect(ongletProfil).toHaveAttribute("aria-selected", "true");

    const ongletDocuments = page.getByRole("tab", { name: "Documents" });
    await expect(ongletDocuments).toHaveAttribute("aria-selected", "false");

    // Activation clavier : focus + Entrée doit basculer l'onglet, exactement
    // comme un clic — jamais une action réservée à la souris.
    await ongletDocuments.focus();
    await page.keyboard.press("Enter");
    await expect(ongletDocuments).toHaveAttribute("aria-selected", "true");
    await expect(ongletProfil).toHaveAttribute("aria-selected", "false");
  });
});

test.describe("Accessibilité — carte de besoin Client (bascule clavier)", () => {
  test.use({ storageState: CLIENT_STATE });

  test("la carte de besoin est activable au clavier (Entrée), pas seulement à la souris", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = `${Date.now()}-a11y-e2e`;
    const titre = `Besoin accessibilité ${suffixe}`;
    await prisma.clientNeed.create({
      data: { clientId: client!.id, correlationId: `a11y-${suffixe}`, texteOriginal: titre, statut: "SOUMIS" },
    });

    await page.goto("/client/besoins");
    const carte = page.getByRole("button", { name: new RegExp(titre) });
    await expect(carte).toBeVisible();
    await expect(carte).toHaveAttribute("tabindex", "0");
    await expect(carte).toHaveAttribute("aria-expanded", "false");

    await carte.focus();
    await page.keyboard.press("Enter");
    await expect(carte).toHaveAttribute("aria-expanded", "true");

    // La barre d'espace doit aussi activer/désactiver — comportement natif
    // attendu de role="button", reproduit explicitement ici (voir
    // onKeyDown dans app/client/besoins/page.tsx).
    await page.keyboard.press(" ");
    await expect(carte).toHaveAttribute("aria-expanded", "false");
  });
});
