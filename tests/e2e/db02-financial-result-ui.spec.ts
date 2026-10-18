import { test, expect, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-02 : Financial Result UI (08/10/2026).
//
// Parcours réel (mandat §15, "E2E") — session Admin pré-authentifiée
// (voir tests/setup/auth.setup.ts), jamais une reconnexion ici. Couvre à
// la fois la consultation et, puisqu'une mutation officielle existe
// (A29 : création + finalisation + correction), le parcours de mutation
// complet via la page réelle.

test.describe("Admin — Mission → Financial Result (DB-02)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin ouvre le Résultat financier d'une Mission, crée un résultat, le finalise puis le corrige", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const profil = await prisma.profil.create({ data: { nom: `Profil E2E DB02 ${suffixe}` } });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, repere: `Mission E2E DB02 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "TERMINEE" },
    });

    await page.goto("/admin/missions");
    const ligne = page.locator("tr").filter({ has: page.getByRole("cell", { name: mission.repere!, exact: true }) });
    await ligne.getByRole("link", { name: /résultat financier/i }).click();

    await expect(page.getByRole("heading", { name: /résultat financier/i })).toBeVisible();
    await expect(page.getByText(/aucun résultat financier enregistré/i)).toBeVisible();

    await page.getByRole("button", { name: /nouveau résultat financier/i }).click();
    await page.getByLabel(/^revenu$/i).fill("10000");
    await page.getByLabel(/justification/i).first().fill("Facture signée et encaissée.");
    await page.getByRole("button", { name: /^créer$/i }).click();

    await expect(page.getByText("DRAFT")).toBeVisible();
    // toLocaleString("fr-FR") insère une espace fine insécable (U+202F ou
    // U+00A0 selon l'environnement ICU) entre les milliers, jamais une
    // espace normale — le motif tolère les deux.
    await expect(page.getByText(/10[\s  ]000,00/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /finaliser/i }).click();
    await expect(page.getByText("FINALIZED")).toBeVisible();

    const resultatInitial = await prisma.financialResult.findFirst({ where: { missionId: mission.id } });
    expect(resultatInitial?.statut).toBe("FINALIZED");

    // Correction : nouvelle ligne, jamais un écrasement.
    await page.getByRole("button", { name: /correction \(nouvelle ligne\)/i }).click();
    await page.getByLabel(/^revenu$/i).fill("12000");
    await page.getByLabel(/justification/i).first().fill("Montant corrigé après vérification.");
    await page.getByRole("button", { name: /créer la correction/i }).click();

    await expect(page.getByText(/remplace/i)).toBeVisible();
    await expect(page.getByText(/12[\s  ]000,00/)).toBeVisible();

    const tousLesResultats = await prisma.financialResult.findMany({ where: { missionId: mission.id } });
    expect(tousLesResultats).toHaveLength(2);
    const original = tousLesResultats.find((r) => r.id === resultatInitial!.id)!;
    expect(Number(original.revenueAmount)).toBe(10000); // jamais écrasé
    expect(original.statut).toBe("FINALIZED");
  });
});
