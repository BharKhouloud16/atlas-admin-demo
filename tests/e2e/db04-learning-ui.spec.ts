import { test, expect, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-04 : Learning UI (08/10/2026).
//
// Parcours réel (mandat §23, "Minimum E2E") — session Admin
// pré-authentifiée (tests/setup/auth.setup.ts), jamais une reconnexion
// ici. Couvre : consultation de la liste, ouverture du détail d'un
// Learning PROPOSE, validation réelle via le bouton (PATCH A30
// inchangée), puis marquage obsolète réel via le bouton — jamais une
// simulation de succès, toujours une vérification post-rechargement.

test.describe("Admin — Mission → Learning (DB-04)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin consulte les Learnings d'une Mission, ouvre un Learning PROPOSE, le valide puis le marque obsolète", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
    if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: user.profilId, repere: `Mission E2E DB04 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "TERMINEE" },
    });
    const learning = await prisma.learning.create({
      data: {
        missionId: mission.id,
        type: "LESSON",
        title: `Learning E2E DB04 ${suffixe}`,
        statement: "Constat factuel observé durant cette mission de test E2E.",
        provenance: "INFERRED",
        confidence: "HIGH",
        scope: "MISSION",
        createdByEmail: "admin-demo@example.com",
        createdByRole: "ADMIN",
      },
    });

    await page.goto("/admin/missions");
    const ligne = page.locator("tr").filter({ has: page.getByRole("cell", { name: mission.repere!, exact: true }) });
    await ligne.getByRole("link", { name: /^learning/i }).click();

    await expect(page.getByRole("heading", { name: /learnings de la mission/i })).toBeVisible();
    const ligneLearning = page.locator("tr").filter({ has: page.getByText(learning.title, { exact: true }) });
    await expect(ligneLearning).toBeVisible();
    await ligneLearning.getByRole("link", { name: /ouvrir/i }).click();

    await expect(page.getByRole("heading", { name: learning.title, exact: true })).toBeVisible();
    await expect(page.getByText("PROPOSE", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("INFERRED")).toBeVisible();
    await expect(page.getByText("HIGH")).toBeVisible();

    await page.getByRole("button", { name: /^valider$/i }).click();
    await expect(page.getByText("VALIDE", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/validé le/i)).toBeVisible();
    // La provenance ne doit jamais être "promue" par la validation.
    await expect(page.getByText("INFERRED")).toBeVisible();

    const apresValidation = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
    expect(apresValidation.statut).toBe("VALIDE");
    expect(apresValidation.provenance).toBe("INFERRED");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /marquer obsolète/i }).click();
    await expect(page.getByText("OBSOLETE", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/marqué obsolète le/i)).toBeVisible();

    const apresObsolescence = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
    expect(apresObsolescence.applicabilite).toBe("OBSOLETE");
    expect(apresObsolescence.statut).toBe("VALIDE"); // statut et applicabilité restent indépendants
  });
});
