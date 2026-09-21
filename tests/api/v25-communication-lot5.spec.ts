import { test, expect, APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 5 — UX, 21/09/2026).
//
// Couvre GET /api/admin/messages/non-lus (vue agrégée pour le badge par
// ligne de app/admin/clients/page.tsx) : RBAC, individualité par Admin,
// exactitude du calcul batché (jamais une requête par Client).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerAdminConnecte() {
  const s = suffixe();
  const email = `lot5-admin-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const user = await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email, userId: user.id };
}

test.describe("V2.5 Lot 5 — GET /api/admin/messages/non-lus", () => {
  test("non authentifié -> 403", async ({ request }) => {
    expect((await request.get("/api/admin/messages/non-lus")).status()).toBe(403);
  });

  test("CLIENT et INGENIEUR -> 403", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    expect((await request.get("/api/admin/messages/non-lus")).status()).toBe(403);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/admin/messages/non-lus")).status()).toBe(403);
  });

  test("un client avec message CLIENT jamais lu apparaît dans clientIdsNonLus", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const admin = await creerAdminConnecte();

    await connecter(request, admin.email);
    const reponse = await request.get("/api/admin/messages/non-lus");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.clientIdsNonLus).toContain(client.id);
  });

  test("un client sans message CLIENT (seulement ADMIN) n'apparaît jamais", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 SansClient ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "x" } });
    const admin = await creerAdminConnecte();

    await connecter(request, admin.email);
    const reponse = await request.get("/api/admin/messages/non-lus");
    const corps = await reponse.json();
    expect(corps.clientIdsNonLus).not.toContain(client.id);
  });

  test("marquer le fil lu retire ce client de clientIdsNonLus pour CET Admin", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 Lu ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const admin = await creerAdminConnecte();

    await connecter(request, admin.email);
    expect((await (await request.get("/api/admin/messages/non-lus")).json()).clientIdsNonLus).toContain(client.id);

    await request.post(`/api/clients/${client.id}/messages/lu`);
    const apres = await (await request.get("/api/admin/messages/non-lus")).json();
    expect(apres.clientIdsNonLus).not.toContain(client.id);
  });

  test("individualité : un second Admin (jamais lu) voit toujours le client comme non lu après que le premier a lu", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 Individuel ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const adminA = await creerAdminConnecte();
    const adminB = await creerAdminConnecte();

    await connecter(request, adminA.email);
    await request.post(`/api/clients/${client.id}/messages/lu`);

    await connecter(request, adminB.email);
    const corps = await (await request.get("/api/admin/messages/non-lus")).json();
    expect(corps.clientIdsNonLus).toContain(client.id); // jamais affecté par la lecture de l'Admin A
  });
});
