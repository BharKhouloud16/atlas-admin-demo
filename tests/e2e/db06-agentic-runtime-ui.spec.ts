import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-06 : Agentic Runtime UI (08/10/2026).
//
// Parcours réel (mandat §21, E2E) — session Admin pré-authentifiée
// (tests/setup/auth.setup.ts), jamais une reconnexion ici. Couvre :
// liste des Runs, ouverture du détail, WAITING_APPROVAL affiché
// clairement, approbation réelle via l'API Control Plane existante
// (jamais simulée), reprise du Run, Steps/ActionExecution affichés.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idAgent(request: APIRequestContext, nom: string): Promise<string> {
  const reponse = await request.get("/api/security/agents");
  const { agents } = await reponse.json();
  const agent = agents.find((a: { agent: string }) => a.agent === nom);
  if (!agent) throw new Error(`Agent ${nom} introuvable`);
  return agent.id;
}

test.describe("Admin — Agentic Runtime (DB-06)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin consulte la liste des Runs, ouvre un Run WAITING_APPROVAL, approuve via l'API existante puis le reprend jusqu'à SUCCEEDED", async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    const agentId = await idAgent(request, "ATLAS_TALENT");
    await connecter(request, "admin-demo@example.com");
    const creation = await request.post("/api/agentic-runs", {
      data: {
        agentIdentityId: agentId,
        declaredAction: "WRITE",
        declaredScope: "TALENT",
        goal: `Objectif E2E DB-06 ${Date.now()}`,
        maxIterations: 2,
      },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const run = await creation.json();

    await page.goto("/admin/agentic-runs");
    await expect(page.getByRole("heading", { name: /agentic runtime/i })).toBeVisible();
    const ligneRun = page.locator("tr").filter({ has: page.locator(`code:text("${run.id.slice(0, 10)}")`) });
    await expect(ligneRun).toBeVisible();
    await ligneRun.getByRole("link", { name: /ouvrir/i }).click();

    await expect(page.getByRole("button", { name: /^démarrer$/i })).toBeVisible();
    await page.getByRole("button", { name: /^démarrer$/i }).click();

    await expect(page.getByText("⚠ APPROBATION ADMIN REQUISE")).toBeVisible();
    await expect(page.getByRole("cell", { name: /write\/talent \(classe/i })).toBeVisible();

    await page.locator("textarea").first().fill("Approuvé pour test E2E DB-06.");
    await page.getByRole("button", { name: /approuver \(allow\)/i }).click();

    await expect(page.getByText(/décision déjà enregistrée/i).first()).toBeVisible();
    await expect(page.getByText("ALLOW", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: /reprendre le run/i }).click();
    await expect(page.locator("span").filter({ hasText: /^SUCCEEDED$/ }).first()).toBeVisible();
    await expect(page.getByText(/run terminé avec succès/i)).toBeVisible();

    const apres = await prisma.agenticRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(apres.statut).toBe("SUCCEEDED");
    expect(apres.stopReason).toBe("GOAL_REACHED");
  });

  test("l'Admin voit les Steps d'un Run observé sans jamais confondre proposition et exécution", async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    const agentId = await idAgent(request, "ATLAS_TALENT");
    await connecter(request, "admin-demo@example.com");
    const creation = await request.post("/api/agentic-runs", {
      data: { agentIdentityId: agentId, declaredAction: "READ", declaredScope: "TALENT", goal: `Observation E2E DB-06 ${Date.now()}`, maxIterations: 2 },
    });
    const run = await creation.json();
    await request.post(`/api/agentic-runs/${run.id}/start`);

    await page.goto(`/admin/agentic-runs/${run.id}`);
    await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();
    await expect(page.getByText("Step 1 — PROPOSE_AND_ACT")).toBeVisible();
    await expect(page.getByText("runtime.ping")).toBeVisible();
  });
});
