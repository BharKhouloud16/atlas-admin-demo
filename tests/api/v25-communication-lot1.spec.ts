import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 1 — Read State,
// 21/09/2026).
//
// Couvre POST /api/client/messages/lu, POST /api/clients/[id]/messages/lu
// et l'enrichissement `nonLus` de GET /api/client/messages et GET
// /api/clients/[id]/messages. Même patron de connexion réelle que
// tests/api/c8-client-communication.spec.ts (ces routes appartiennent à la
// même famille et ont besoin de bascules de rôle au sein d'un même test).
//
// RBAC/IDOR/individualité-Admin/idempotence/concurrence — mandat V2.5
// section "SÉCURITÉ"/"PERFORMANCE" : session-derived ownership, User.id pour
// la lecture Admin, IDOR/BOLA systématiquement testés, 404-jamais-403 pour
// l'existence d'un Client tiers.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  expect(client).toBeTruthy();
  return client!;
}

async function userIdDemo(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeTruthy();
  return user!.id;
}

test.describe("V2.5 Lot 1 — RBAC : POST */messages/lu réservé au rôle attendu", () => {
  test("non authentifié -> 403 sur les deux routes", async ({ request }) => {
    const client = await clientDemo();
    expect((await request.post("/api/client/messages/lu")).status()).toBe(403);
    expect((await request.post(`/api/clients/${client.id}/messages/lu`)).status()).toBe(403);
  });

  test("INGENIEUR -> 403 sur les deux routes", async ({ request }) => {
    const client = await clientDemo();
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.post("/api/client/messages/lu")).status()).toBe(403);
    expect((await request.post(`/api/clients/${client.id}/messages/lu`)).status()).toBe(403);
  });

  test("ADMIN -> 403 sur la route Client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    expect((await request.post("/api/client/messages/lu")).status()).toBe(403);
  });

  test("CLIENT -> 403 sur la route Admin", async ({ request }) => {
    const client = await clientDemo();
    await connecter(request, "client-demo@example.com");
    expect((await request.post(`/api/clients/${client.id}/messages/lu`)).status()).toBe(403);
  });

  test("Admin, client inexistant -> 404 (jamais 403 : aucune fuite d'existence)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/clients/inexistant-xyz/messages/lu");
    expect(reponse.status()).toBe(404);
  });
});

test.describe("V2.5 Lot 1 — Curseur de lecture : création, idempotence, isolation", () => {
  test("Client marque son fil lu -> curseur MessageLecture créé pour (son client, son User.id)", async ({ request }) => {
    const client = await clientDemo();
    const userId = await userIdDemo("client-demo@example.com");

    await connecter(request, "client-demo@example.com");
    const reponse = await request.post("/api/client/messages/lu");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.dernierLuLe).toBeTruthy();

    const curseur = await prisma.messageLecture.findUnique({ where: { clientId_userId: { clientId: client.id, userId } } });
    expect(curseur).toBeTruthy();
  });

  test("idempotence : deux appels successifs ne créent jamais deux curseurs, seulement une mise à jour", async ({ request }) => {
    const client = await clientDemo();
    const userId = await userIdDemo("client-demo@example.com");

    await connecter(request, "client-demo@example.com");
    await request.post("/api/client/messages/lu");
    await new Promise((r) => setTimeout(r, 5));
    const deuxieme = await request.post("/api/client/messages/lu");
    expect(deuxieme.ok()).toBeTruthy();

    const curseurs = await prisma.messageLecture.findMany({ where: { clientId: client.id, userId } });
    expect(curseurs).toHaveLength(1);
  });

  test("concurrence : appels simultanés sur le même (client, user) ne créent jamais de doublon", async ({ request }) => {
    const client = await clientDemo();
    const userId = await userIdDemo("client-demo@example.com");

    await connecter(request, "client-demo@example.com");
    const reponses = await Promise.all([
      request.post("/api/client/messages/lu"),
      request.post("/api/client/messages/lu"),
      request.post("/api/client/messages/lu"),
    ]);
    expect(reponses.every((r) => r.ok())).toBeTruthy();

    const curseurs = await prisma.messageLecture.findMany({ where: { clientId: client.id, userId } });
    expect(curseurs).toHaveLength(1);
  });

  test("IDOR : un Client marquant son propre fil lu ne crée/modifie jamais le curseur d'un autre Client", async ({ request }) => {
    const autreClient = await prisma.client.create({ data: { nom: `Client Lot1 IDOR ${Date.now()}` } });

    await request.post("/api/client/messages/lu"); // non authentifié -> refusé, aucun effet de toute façon
    await connecter(request, "client-demo@example.com");
    await request.post("/api/client/messages/lu");

    const curseurAutreClient = await prisma.messageLecture.findMany({ where: { clientId: autreClient.id } });
    expect(curseurAutreClient).toHaveLength(0);
  });

  test("individualité Admin : le curseur d'un second Admin (jamais connecté) n'est jamais touché par la lecture du premier", async ({ request }) => {
    const client = await clientDemo();
    const ancienneDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const secondAdmin = await prisma.user.create({
      data: { email: `admin-lot1-second-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });
    await prisma.messageLecture.create({ data: { clientId: client.id, userId: secondAdmin.id, dernierLuLe: ancienneDate } });

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/clients/${client.id}/messages/lu`);
    expect(reponse.ok()).toBeTruthy();

    const curseurSecondAdmin = await prisma.messageLecture.findUnique({
      where: { clientId_userId: { clientId: client.id, userId: secondAdmin.id } },
    });
    expect(curseurSecondAdmin!.dernierLuLe.getTime()).toBe(ancienneDate.getTime()); // jamais modifié par la lecture du premier Admin

    const userIdPremierAdmin = await userIdDemo("admin-demo@example.com");
    const curseurPremierAdmin = await prisma.messageLecture.findUnique({
      where: { clientId_userId: { clientId: client.id, userId: userIdPremierAdmin } },
    });
    expect(curseurPremierAdmin).toBeTruthy(); // propre curseur créé pour ce premier Admin
  });
});

test.describe("V2.5 Lot 1 — Enrichissement nonLus de GET */messages", () => {
  test("GET Admin : nonLus compte les messages CLIENT postérieurs au curseur de CET Admin, jamais ceux d'ADMIN", async ({ request }) => {
    const creation = await prisma.client.create({ data: { nom: `Client Lot1 NonLus Admin ${Date.now()}` } });

    await connecter(request, "admin-demo@example.com");
    await request.post(`/api/clients/${creation.id}/messages/lu`); // curseur initial, aucun message

    await prisma.message.create({ data: { clientId: creation.id, auteurRole: "CLIENT", contenu: "Message client 1" } });
    await prisma.message.create({ data: { clientId: creation.id, auteurRole: "ADMIN", contenu: "Message admin (jamais compté)" } });

    const reponse = await request.get(`/api/clients/${creation.id}/messages`);
    const corps = await reponse.json();
    expect(corps.nonLus).toBe(1);

    await request.post(`/api/clients/${creation.id}/messages/lu`);
    const apres = await request.get(`/api/clients/${creation.id}/messages`);
    expect((await apres.json()).nonLus).toBe(0);
  });

  test("GET Client : nonLus compte les messages ADMIN postérieurs au curseur du Client, jamais ceux du Client lui-même", async ({ request }) => {
    const client = await clientDemo();
    await connecter(request, "client-demo@example.com");
    await request.post("/api/client/messages/lu"); // repartir d'un curseur à jour

    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "Réponse admin non lue" } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Propre message (jamais compté)" } });

    const reponse = await request.get("/api/client/messages");
    const corps = await reponse.json();
    expect(corps.nonLus).toBeGreaterThanOrEqual(1);

    await request.post("/api/client/messages/lu");
    const apres = await request.get("/api/client/messages");
    expect((await apres.json()).nonLus).toBe(0);
  });

  test("aucun curseur préexistant -> tous les messages du côté opposé sont comptés non lus", async ({ request }) => {
    const creation = await prisma.client.create({ data: { nom: `Client Lot1 SansCurseur ${Date.now()}` } });
    await prisma.message.create({ data: { clientId: creation.id, auteurRole: "CLIENT", contenu: "Premier message jamais lu" } });
    await prisma.message.create({ data: { clientId: creation.id, auteurRole: "CLIENT", contenu: "Second message jamais lu" } });

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/clients/${creation.id}/messages`);
    const corps = await reponse.json();
    expect(corps.nonLus).toBe(2);
  });
});
