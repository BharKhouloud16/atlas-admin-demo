import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// LOT 5 (28/10/2026) — ATLAS OS : jamais actif par défaut, demande du Client,
// décision de l'Admin (activer, refuser, désactiver), contrôles serveur,
// journalisation.

const MDP = "Demo1234";

async function clientIsole() {
  const s = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const client = await prisma.client.create({ data: { nom: `Client lot5 ${s}` } });
  const email = `client-lot5-${s}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email };
}

async function connecter(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/login", { data: { email, password: MDP } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.describe("LOT 5 — activation d'ATLAS OS", () => {
  test("parcours complet : disponible -> demandée -> activée -> désactivée -> redemandée", async ({ request }) => {
    const { client, email } = await clientIsole();
    await connecter(request, email);
    expect((await (await request.get("/api/client/atlas-os")).json()).etat).toBe("DISPONIBLE");

    const demande = await request.post("/api/client/atlas-os", { data: { motif: "Audit de sécurité" } });
    expect(demande.status()).toBe(201);
    expect((await demande.json()).etat).toBe("EN_ATTENTE");
    expect((await request.post("/api/client/atlas-os", { data: {} })).status()).toBe(409);
    // Le Client ne peut jamais s'activer lui-même.
    expect((await request.patch(`/api/atlas-os/activations/${client.id}`, { data: { statut: "ACTIVEE" } })).status()).toBe(403);
    expect((await request.get("/api/atlas-os/activations")).status()).toBe(403);

    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/atlas-os/activations/${client.id}`, { data: { statut: "ACTIVEE" } })).status()).toBe(200);
    expect((await request.patch(`/api/atlas-os/activations/${client.id}`, { data: { statut: "ACTIVEE" } })).status()).toBe(409);

    await connecter(request, email);
    expect((await (await request.get("/api/client/atlas-os")).json()).etat).toBe("ACTIVE");

    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/atlas-os/activations/${client.id}`, { data: { statut: "DESACTIVEE", motif: "Fin de test" } })).status()).toBe(200);
    await connecter(request, email);
    expect((await (await request.get("/api/client/atlas-os")).json()).etat).toBe("DISPONIBLE");
    expect((await request.post("/api/client/atlas-os", { data: {} })).status()).toBe(201);

    const journal = await prisma.journalActivite.findMany({ where: { cible: client.id }, orderBy: { createdAt: "asc" } });
    expect(journal.map((j) => j.action)).toEqual(["atlas_os_demande_activation", "atlas_os_activee", "atlas_os_desactivee", "atlas_os_demande_activation"]);
  });

  test("refus : le motif est communiqué au Client, qui ne peut pas redemander seul", async ({ request }) => {
    const { client, email } = await clientIsole();
    await connecter(request, email);
    await request.post("/api/client/atlas-os", { data: {} });
    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/atlas-os/activations/${client.id}`, { data: { statut: "REFUSEE", motif: "Offre non ouverte dans votre pays" } })).status()).toBe(200);
    await connecter(request, email);
    const etat = await (await request.get("/api/client/atlas-os")).json();
    expect(etat).toMatchObject({ etat: "INDISPONIBLE", motifDecision: "Offre non ouverte dans votre pays" });
    expect((await request.post("/api/client/atlas-os", { data: {} })).status()).toBe(409);
  });

  test("un Ingénieur n'accède ni à l'état client ni à la gestion Admin", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/client/atlas-os")).status()).toBe(403);
    expect((await request.get("/api/atlas-os/activations")).status()).toBe(403);
  });
});
