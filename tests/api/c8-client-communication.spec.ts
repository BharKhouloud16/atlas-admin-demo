import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
// Couvre GET/POST /api/client/messages (Client) et GET/POST
// /api/clients/[id]/messages (Admin) — même table Message. Isolation
// stricte entre clients, clientId jamais accepté depuis le corps de la
// requête côté Client, INGENIEUR jamais autorisé (ni côté Client ni côté
// Admin — le métier ne l'autorise pas à voir les communications client),
// validation du contenu, round-trip Client<->Admin sur la même
// conversation.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("COMPANY ATLAS C8 — GET/POST /api/client/messages", () => {
  test("non authentifié -> 403 sur GET et POST", async ({ request }) => {
    const get = await request.get("/api/client/messages");
    expect(get.status()).toBe(403);
    const post = await request.post("/api/client/messages", { data: { contenu: "x" } });
    expect(post.status()).toBe(403);
  });

  test("ADMIN et INGENIEUR -> 403 (le métier ne les autorise pas sur cette route Client)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const admin = await request.get("/api/client/messages");
    expect(admin.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const ingenieur = await request.get("/api/client/messages");
    expect(ingenieur.status()).toBe(403);
    const ingenieurPost = await request.post("/api/client/messages", { data: { contenu: "x" } });
    expect(ingenieurPost.status()).toBe(403);
  });

  test("contenu valide -> 201, auteurRole CLIENT, clientId dérivé de la session", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });

    const reponse = await request.post("/api/client/messages", { data: { contenu: `Question de test C8 ${Date.now()}` } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { message } = await reponse.json();
    expect(message.auteurRole).toBe("CLIENT");

    const enBase = await prisma.message.findUnique({ where: { id: message.id } });
    expect(enBase?.clientId).toBe(client!.id);
  });

  test("contenu vide ou trop long -> 400, aucun message créé", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const avant = await prisma.message.count();

    const vide = await request.post("/api/client/messages", { data: { contenu: "" } });
    expect(vide.status()).toBe(400);

    const tropLong = await request.post("/api/client/messages", { data: { contenu: "a".repeat(2001) } });
    expect(tropLong.status()).toBe(400);

    expect(await prisma.message.count()).toBe(avant);
  });

  test("clientId fourni dans le corps est structurellement ignoré — toujours celui de la session", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const creationClient = await request.post("/api/clients", { data: { nom: `Client C8 Spoof ${Date.now()}` } });
    const autreClient = await creationClient.json();

    await connecter(request, "client-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const reponse = await request.post("/api/client/messages", {
      data: { contenu: `Tentative de spoof ${Date.now()}`, clientId: autreClient.id },
    });
    expect(reponse.status()).toBe(201);
    const { message } = await reponse.json();
    expect(message.clientId).toBe(client!.id);
    expect(message.clientId).not.toBe(autreClient.id);
  });

  test("isolation : un client ne voit jamais les messages d'un autre client dans son propre GET", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const creationClient = await request.post("/api/clients", { data: { nom: `Client C8 Isolation ${Date.now()}` } });
    const autreClient = await creationClient.json();
    await prisma.message.create({ data: { clientId: autreClient.id, auteurRole: "ADMIN", contenu: "Message confidentiel d'un autre client" } });

    await connecter(request, "client-demo@example.com");
    const reponse = await request.get("/api/client/messages");
    expect(reponse.ok()).toBeTruthy();
    const { messages } = await reponse.json();
    expect(messages.some((m: { contenu: string }) => m.contenu === "Message confidentiel d'un autre client")).toBe(false);
  });

  test("ordre chronologique croissant (les plus anciens d'abord)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const suffixe = Date.now();
    await request.post("/api/client/messages", { data: { contenu: `Premier message ${suffixe}` } });
    await request.post("/api/client/messages", { data: { contenu: `Second message ${suffixe}` } });

    const reponse = await request.get("/api/client/messages");
    const { messages } = await reponse.json();
    const indexPremier = messages.findIndex((m: { contenu: string }) => m.contenu === `Premier message ${suffixe}`);
    const indexSecond = messages.findIndex((m: { contenu: string }) => m.contenu === `Second message ${suffixe}`);
    expect(indexPremier).toBeGreaterThanOrEqual(0);
    expect(indexSecond).toBeGreaterThan(indexPremier);
  });
});

test.describe("COMPANY ATLAS C8 — GET/POST /api/clients/[id]/messages (Admin)", () => {
  test("non authentifié -> 403", async ({ request }) => {
    const client = await prisma.client.findFirst();
    const get = await request.get(`/api/clients/${client!.id}/messages`);
    expect(get.status()).toBe(403);
    const post = await request.post(`/api/clients/${client!.id}/messages`, { data: { contenu: "x" } });
    expect(post.status()).toBe(403);
  });

  test("CLIENT et INGENIEUR -> 403 (INGENIEUR ne doit jamais voir les communications client)", async ({ request }) => {
    const client = await prisma.client.findFirst();

    await connecter(request, "client-demo@example.com");
    const commeClient = await request.get(`/api/clients/${client!.id}/messages`);
    expect(commeClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const commeIngenieur = await request.get(`/api/clients/${client!.id}/messages`);
    expect(commeIngenieur.status()).toBe(403);
    const commeIngenieurPost = await request.post(`/api/clients/${client!.id}/messages`, { data: { contenu: "x" } });
    expect(commeIngenieurPost.status()).toBe(403);
  });

  test("client inexistant -> 404 sur GET et POST", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const get = await request.get("/api/clients/inexistant-xyz/messages");
    expect(get.status()).toBe(404);
    const post = await request.post("/api/clients/inexistant-xyz/messages", { data: { contenu: "x" } });
    expect(post.status()).toBe(404);
  });

  test("contenu vide ou trop long -> 400, aucun message créé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const avant = await prisma.message.count({ where: { clientId: client!.id } });

    const vide = await request.post(`/api/clients/${client!.id}/messages`, { data: { contenu: "" } });
    expect(vide.status()).toBe(400);
    const tropLong = await request.post(`/api/clients/${client!.id}/messages`, { data: { contenu: "a".repeat(2001) } });
    expect(tropLong.status()).toBe(400);

    expect(await prisma.message.count({ where: { clientId: client!.id } })).toBe(avant);
  });

  test("IDOR : les messages du client A ne remontent jamais dans le GET du client B", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const creationA = await request.post("/api/clients", { data: { nom: `Client C8 A ${Date.now()}` } });
    const clientA = await creationA.json();
    const creationB = await request.post("/api/clients", { data: { nom: `Client C8 B ${Date.now()}` } });
    const clientB = await creationB.json();

    await request.post(`/api/clients/${clientA.id}/messages`, { data: { contenu: "Message réservé au client A" } });

    const reponseB = await request.get(`/api/clients/${clientB.id}/messages`);
    const { messages } = await reponseB.json();
    expect(messages.some((m: { contenu: string }) => m.contenu === "Message réservé au client A")).toBe(false);
  });

  test("round-trip : un message client est visible côté Admin, un message Admin est visible côté client, sur la même conversation", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = Date.now();
    const depuisClient = await request.post("/api/client/messages", { data: { contenu: `Depuis le client ${suffixe}` } });
    expect(depuisClient.status()).toBe(201);

    await connecter(request, "admin-demo@example.com");
    const vueAdmin = await request.get(`/api/clients/${client!.id}/messages`);
    const { messages: messagesAdmin } = await vueAdmin.json();
    expect(messagesAdmin.some((m: { contenu: string; auteurRole: string }) => m.contenu === `Depuis le client ${suffixe}` && m.auteurRole === "CLIENT")).toBe(true);

    const depuisAdmin = await request.post(`/api/clients/${client!.id}/messages`, { data: { contenu: `Depuis l'admin ${suffixe}` } });
    expect(depuisAdmin.status()).toBe(201);

    await connecter(request, "client-demo@example.com");
    const vueClient = await request.get("/api/client/messages");
    const { messages: messagesClient } = await vueClient.json();
    expect(messagesClient.some((m: { contenu: string; auteurRole: string }) => m.contenu === `Depuis l'admin ${suffixe}` && m.auteurRole === "ADMIN")).toBe(true);
  });
});
