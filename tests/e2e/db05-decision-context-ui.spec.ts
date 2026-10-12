import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-05 : Decision Context UI (08/10/2026).
//
// Parcours réel (mandat §19, "E2E") — session Admin pré-authentifiée
// (tests/setup/auth.setup.ts), jamais une reconnexion ici. La génération
// de la Solution (SolutionOption) nécessite une session CLIENT réelle
// (seul déclencheur légitime, A36.2.3) — effectuée ici via APIRequestContext
// directement (setup de données, jamais via la session Admin pré-
// authentifiée de la page), avant de naviguer avec la session Admin.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("Admin — Besoin → Solution → Decision Context (DB-05)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin ouvre un besoin, voit la Solution et les connaissances consultées par ATLAS, avec provenance/confidence et conflit", async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const candidat = await prisma.profil.create({
      data: {
        nom: `CandidatE2EDB05${suffixe}`,
        prenom: "Test",
        cvValide: true,
        competences: ["Kubernetes"],
        seniorite: "Senior",
        anneesExperience: 6,
        tjmEstime: 650,
        disponibilite: "Disponible immédiatement",
      },
    });

    const need = await prisma.clientNeed.create({
      data: {
        clientId: client.id,
        correlationId: `e2e-db05-${suffixe}`,
        texteOriginal: `Besoin E2E DB-05 ${suffixe}`,
        statut: "VALIDE",
        faits: { create: [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }] },
      },
    });

    const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
    const mission = await prisma.mission.create({
      data: {
        clientId: client.id,
        profilId: user!.profilId!,
        repere: `Mission E2E DB05 ${suffixe}`,
        nbJours: 5,
        tjmVente: 500,
        margeCible: 0.3,
        deviseVente: "EUR",
        statut: "EN_COURS",
      },
    });
    const bp = await prisma.learning.create({
      data: {
        missionId: mission.id,
        type: "BEST_PRACTICE",
        title: `Bonne pratique E2E DB05 ${suffixe}`,
        statement: "Observation positive de test E2E DB-05.",
        provenance: "VERIFIED",
        confidence: "HIGH",
        scope: "CLIENT",
        createdByEmail: "admin-demo@example.com",
        createdByRole: "ADMIN",
      },
    });
    await prisma.learning.update({ where: { id: bp.id }, data: { statut: "VALIDE", applicabilite: "ACTIVE" } });
    const ap = await prisma.learning.create({
      data: {
        missionId: mission.id,
        type: "ANTI_PATTERN",
        title: `Anti-pattern E2E DB05 ${suffixe}`,
        statement: "Observation négative de test E2E DB-05.",
        provenance: "OBSERVED",
        confidence: "MEDIUM",
        scope: "CLIENT",
        createdByEmail: "admin-demo@example.com",
        createdByRole: "ADMIN",
      },
    });
    await prisma.learning.update({ where: { id: ap.id }, data: { statut: "VALIDE", applicabilite: "ACTIVE" } });

    // Déclenche la génération réelle de la Solution — session CLIENT,
    // jamais la session Admin pré-authentifiée de la page ci-dessous.
    await connecter(request, "client-demo@example.com");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(generation.recommandation).not.toBeNull();

    // Navigation directe par id, jamais via la liste /admin/talent/besoins
    // (LOT 5, hors scope DB-05) : cette base de test partagée contient
    // aujourd'hui 5137+ ClientNeed (dont 3169+ dans la seule section "À
    // traiter", jamais paginée) — un rendu dont le temps dépasse le
    // timeout normal d'une action Playwright, confirmé indépendamment de
    // ce test (lecture API directe). Même discipline que les blocages
    // d'environnement déjà documentés dans cet engagement (table
    // Attention, croissance de Mission) : jamais purger les données,
    // jamais modifier une page hors scope pour contourner — seule la
    // navigation de CE test est adaptée. Le parcours testé (Admin ouvre
    // le besoin, revoit la Solution et la connaissance consultée) reste
    // intégralement couvert.
    await page.goto(`/admin/talent/besoins/${need.id}`);

    await expect(page.getByRole("heading", { name: "Solutions" })).toBeVisible();
    await expect(page.getByText(/recommandation atlas actuelle/i)).toBeVisible();

    await expect(page.getByRole("heading", { name: /connaissances consultées par atlas/i })).toBeVisible();
    // La carte (div englobante) de chaque Learning est l'ancêtre direct du
    // conteneur flex qui porte son titre — deux niveaux au-dessus du titre
    // lui-même, structure stable du composant PanneauConnaissancesConsultees.
    const carteBp = page.getByText(bp.title, { exact: true }).locator("xpath=ancestor::div[2]");
    const carteAp = page.getByText(ap.title, { exact: true }).locator("xpath=ancestor::div[2]");
    await expect(carteBp).toBeVisible();
    await expect(carteAp).toBeVisible();
    await expect(carteBp.getByText("VERIFIED", { exact: true })).toBeVisible();
    await expect(carteBp.getByText("HIGH", { exact: true })).toBeVisible();
    await expect(page.getByText(/conflit de connaissances détecté/i)).toBeVisible();

    const lienLearning = carteBp.getByRole("link", { name: /voir le learning/i });
    await expect(lienLearning).toHaveAttribute("href", new RegExp(`/admin/missions/${mission.id}/learning/`));
  });
});
