import { test, expect, APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 3 — Préférences,
// 21/09/2026).
//
// GET/PATCH /api/client/attentions/preferences et
// /api/admin/attentions/preferences — individuelle via User.id (règle
// #12), jamais un userId accepté depuis le corps (mass assignment),
// défauts mandatés (email actif, ACTION_REQUISE+ALERTE actives par
// défaut), RBAC (Ingénieur exclu structurellement).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerUserConnecte(role: "CLIENT" | "ADMIN", suffixe: string) {
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const email = `pref-lot3-${role.toLowerCase()}-${suffixe}@test.local`;
  if (role === "CLIENT") {
    const client = await prisma.client.create({ data: { nom: `Client Lot3 ${suffixe}` } });
    const user = await prisma.user.create({ data: { email, passwordHash, role: "CLIENT", actif: true, clientId: client.id } });
    return { email, userId: user.id };
  }
  const user = await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email, userId: user.id };
}

test.describe("V2.5 Lot 3 — RBAC", () => {
  test("non authentifié -> 403 sur les 4 routes", async ({ request }) => {
    expect((await request.get("/api/client/attentions/preferences")).status()).toBe(403);
    expect((await request.patch("/api/client/attentions/preferences", { data: {} })).status()).toBe(403);
    expect((await request.get("/api/admin/attentions/preferences")).status()).toBe(403);
    expect((await request.patch("/api/admin/attentions/preferences", { data: {} })).status()).toBe(403);
  });

  test("INGENIEUR -> 403 sur les deux routes (exclusion structurelle, règle #8)", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/client/attentions/preferences")).status()).toBe(403);
    expect((await request.get("/api/admin/attentions/preferences")).status()).toBe(403);
  });

  test("ADMIN -> 403 sur la route Client, CLIENT -> 403 sur la route Admin", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    expect((await request.get("/api/client/attentions/preferences")).status()).toBe(403);

    await connecter(request, "client-demo@example.com");
    expect((await request.get("/api/admin/attentions/preferences")).status()).toBe(403);
  });
});

test.describe("V2.5 Lot 3 — Défauts mandatés (aucune ligne en base au premier GET)", () => {
  test("Client sans PreferenceNotification -> emailActif=true, categoriesEmail=[ACTION_REQUISE, ALERTE]", async ({ request }) => {
    const { email, userId } = await creerUserConnecte("CLIENT", `defauts-${Date.now()}`);
    const enBaseAvant = await prisma.preferenceNotification.findUnique({ where: { userId } });
    expect(enBaseAvant).toBeNull();

    await connecter(request, email);
    const reponse = await request.get("/api/client/attentions/preferences");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.emailActif).toBe(true);
    expect(corps.categoriesEmail.sort()).toEqual(["ACTION_REQUISE", "ALERTE"].sort());

    // Un simple GET ne doit jamais matérialiser de ligne (aucun effet de bord en lecture).
    expect(await prisma.preferenceNotification.findUnique({ where: { userId } })).toBeNull();
  });

  test("Admin sans PreferenceNotification -> mêmes défauts que Client", async ({ request }) => {
    const { email } = await creerUserConnecte("ADMIN", `defauts-admin-${Date.now()}`);
    await connecter(request, email);
    const reponse = await request.get("/api/admin/attentions/preferences");
    const corps = await reponse.json();
    expect(corps.emailActif).toBe(true);
    expect(corps.categoriesEmail.sort()).toEqual(["ACTION_REQUISE", "ALERTE"].sort());
  });
});

test.describe("V2.5 Lot 3 — PATCH : écriture, validation, individualité", () => {
  test("désactiver emailActif et étendre categoriesEmail à INFORMATION persiste correctement", async ({ request }) => {
    const { email, userId } = await creerUserConnecte("CLIENT", `patch-${Date.now()}`);
    await connecter(request, email);

    const reponse = await request.patch("/api/client/attentions/preferences", {
      data: { emailActif: false, categoriesEmail: ["ACTION_REQUISE", "INFORMATION"] },
    });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.emailActif).toBe(false);
    expect(corps.categoriesEmail.sort()).toEqual(["ACTION_REQUISE", "INFORMATION"].sort());

    const enBase = await prisma.preferenceNotification.findUnique({ where: { userId } });
    expect(enBase!.emailActif).toBe(false);
    expect(enBase!.categoriesEmail.sort()).toEqual(["ACTION_REQUISE", "INFORMATION"].sort());
  });

  test("PATCH partiel (emailActif seul) préserve categoriesEmail déjà réglé, jamais réinitialisé aux défauts", async ({ request }) => {
    const { email } = await creerUserConnecte("CLIENT", `patch-partiel-${Date.now()}`);
    await connecter(request, email);

    await request.patch("/api/client/attentions/preferences", { data: { categoriesEmail: ["RECOMMANDATION"] } });
    const reponse = await request.patch("/api/client/attentions/preferences", { data: { emailActif: false } });
    const corps = await reponse.json();
    expect(corps.emailActif).toBe(false);
    expect(corps.categoriesEmail).toEqual(["RECOMMANDATION"]); // jamais réinitialisé
  });

  test("categoriesEmail invalide (valeur hors vocabulaire fermé) -> 400, aucune écriture", async ({ request }) => {
    const { email, userId } = await creerUserConnecte("CLIENT", `invalide-${Date.now()}`);
    await connecter(request, email);

    const reponse = await request.patch("/api/client/attentions/preferences", { data: { categoriesEmail: ["NIMPORTEQUOI"] } });
    expect(reponse.status()).toBe(400);
    expect(await prisma.preferenceNotification.findUnique({ where: { userId } })).toBeNull();
  });

  test("categoriesEmail n'est pas un tableau -> 400, jamais un crash serveur", async ({ request }) => {
    const { email } = await creerUserConnecte("CLIENT", `type-invalide-${Date.now()}`);
    await connecter(request, email);
    const reponse = await request.patch("/api/client/attentions/preferences", { data: { categoriesEmail: "ACTION_REQUISE" } });
    expect(reponse.status()).toBe(400);
  });

  test("un userId fourni dans le corps est structurellement ignoré (mass assignment)", async ({ request }) => {
    const { email, userId } = await creerUserConnecte("CLIENT", `spoof-${Date.now()}`);
    const autreUser = await prisma.user.create({
      data: { email: `pref-lot3-spoof-cible-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });

    await connecter(request, email);
    await request.patch("/api/client/attentions/preferences", { data: { emailActif: false, userId: autreUser.id } });

    expect(await prisma.preferenceNotification.findUnique({ where: { userId: autreUser.id } })).toBeNull();
    const enBase = await prisma.preferenceNotification.findUnique({ where: { userId } });
    expect(enBase!.emailActif).toBe(false);
  });

  test("individualité : deux Admins ont des préférences totalement indépendantes", async ({ request }) => {
    const adminA = await creerUserConnecte("ADMIN", `individuel-a-${Date.now()}`);
    const adminB = await creerUserConnecte("ADMIN", `individuel-b-${Date.now()}`);

    await connecter(request, adminA.email);
    await request.patch("/api/admin/attentions/preferences", { data: { emailActif: false } });

    await connecter(request, adminB.email);
    const reponseB = await request.get("/api/admin/attentions/preferences");
    const corpsB = await reponseB.json();
    expect(corpsB.emailActif).toBe(true); // jamais affecté par le PATCH de l'Admin A

    const prefA = await prisma.preferenceNotification.findUnique({ where: { userId: adminA.userId } });
    expect(prefA!.emailActif).toBe(false);
  });
});
