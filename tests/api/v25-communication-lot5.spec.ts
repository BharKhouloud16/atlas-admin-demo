import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 5 — UX, 21/09/2026).
//
// Couvre GET /api/admin/messages/non-lus (vue agrégée pour le badge par
// ligne de app/admin/clients/page.tsx) : RBAC, individualité par Admin,
// exactitude du calcul batché (jamais une requête par Client).
//
// FIX CI (21/09/2026) : le test RBAC "CLIENT et INGENIEUR" migre vers
// storageState (comptes de démo partagés). Les tests d'individualité
// gardent des Admin fraîchement créés mais via
// tests/setup/session-token.ts (session signée directement, sans passer par
// POST /api/auth/login) — voir ce fichier pour la justification (compteur
// RATE_LIMIT_LOGIN_MAX_IP partagé par toute la suite en CI).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerAdmin() {
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

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });
    test("CLIENT -> 403", async ({ request }) => {
      expect((await request.get("/api/admin/messages/non-lus")).status()).toBe(403);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("INGENIEUR -> 403", async ({ request }) => {
      expect((await request.get("/api/admin/messages/non-lus")).status()).toBe(403);
    });
  });

  test("un client avec message CLIENT jamais lu apparaît dans clientIdsNonLus", async () => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const admin = await creerAdmin();

    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get("/api/admin/messages/non-lus");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.clientIdsNonLus).toContain(client.id);
    await ctx.dispose();
  });

  test("un client sans message CLIENT (seulement ADMIN) n'apparaît jamais", async () => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 SansClient ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "x" } });
    const admin = await creerAdmin();

    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get("/api/admin/messages/non-lus");
    const corps = await reponse.json();
    expect(corps.clientIdsNonLus).not.toContain(client.id);
    await ctx.dispose();
  });

  test("marquer le fil lu retire ce client de clientIdsNonLus pour CET Admin", async () => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 Lu ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const admin = await creerAdmin();

    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    expect((await (await ctx.get("/api/admin/messages/non-lus")).json()).clientIdsNonLus).toContain(client.id);

    await ctx.post(`/api/clients/${client.id}/messages/lu`);
    const apres = await (await ctx.get("/api/admin/messages/non-lus")).json();
    expect(apres.clientIdsNonLus).not.toContain(client.id);
    await ctx.dispose();
  });

  test("individualité : un second Admin (jamais lu) voit toujours le client comme non lu après que le premier a lu", async () => {
    const client = await prisma.client.create({ data: { nom: `Client Lot5 Individuel ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    const adminA = await creerAdmin();
    const adminB = await creerAdmin();

    const ctxA = await contexteConnecte({ email: adminA.email, role: "ADMIN" });
    await ctxA.post(`/api/clients/${client.id}/messages/lu`);
    await ctxA.dispose();

    const ctxB = await contexteConnecte({ email: adminB.email, role: "ADMIN" });
    const corps = await (await ctxB.get("/api/admin/messages/non-lus")).json();
    expect(corps.clientIdsNonLus).toContain(client.id); // jamais affecté par la lecture de l'Admin A
    await ctxB.dispose();
  });
});
