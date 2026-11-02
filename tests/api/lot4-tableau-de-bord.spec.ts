import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// LOT 4 (28/10/2026) — tableau de bord Client agrégé côté serveur : chiffres
// issus des seules données du client connecté, tâches réelles (profil
// entreprise, besoins à préciser, profils proposés), libellés métier.

const MDP = "Demo1234";

async function clientIsole(champs: Record<string, string> = {}) {
  const s = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const client = await prisma.client.create({ data: { nom: `Client lot4 ${s}`, ...champs } });
  const email = `client-lot4-${s}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email, s };
}

async function connecter(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/login", { data: { email, password: MDP } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.describe("LOT 4 — tableau de bord", () => {
  test("accès réservé au Client", async ({ request }) => {
    expect((await request.get("/api/client/tableau-de-bord")).status()).toBe(403);
    await connecter(request, "admin-demo@example.com").catch(() => undefined);
    const r = await request.post("/api/auth/login", { data: { email: "admin-demo@example.com", password: MDP } });
    expect(r.ok()).toBeTruthy();
    expect((await request.get("/api/client/tableau-de-bord")).status()).toBe(403);
  });

  test("compteurs exacts, isolés, et tâches réelles", async ({ request }) => {
    const { client, email, s } = await clientIsole();
    const autre = await clientIsole();
    // Données du client
    for (const statut of ["SOUMIS", "A_CLARIFIER", "VALIDE", "ARCHIVE"] as const) {
      await prisma.clientNeed.create({ data: { clientId: client.id, correlationId: `lot4-${s}-${statut}`, texteOriginal: `Besoin ${statut} ${s}`, titre: `Besoin ${statut} ${s}`, statut } });
    }
    // Données d'un autre client (ne doivent jamais être comptées)
    for (let i = 0; i < 3; i++) {
      await prisma.clientNeed.create({ data: { clientId: autre.client.id, correlationId: `lot4-autre-${s}-${i}`, texteOriginal: "Autre client", statut: "A_CLARIFIER" } });
    }
    await connecter(request, email);
    const r = await request.get("/api/client/tableau-de-bord");
    expect(r.status()).toBe(200);
    const t = await r.json();

    expect(t.client).toEqual({ ok: true, donnees: { nom: client.nom } });
    expect(t.compteurs.ok).toBe(true);
    expect(t.compteurs.donnees.besoinsEnCours).toBe(3);
    expect(t.compteurs.donnees.besoinsAPreciser).toBe(1);
    expect(t.compteurs.donnees.missionsActives).toBe(0);
    expect(t.compteurs.donnees.projetsEnCours).toBe(0);

    const taches = t.travailAFaire.donnees as { id: string; titre: string; href: string; priorite: string }[];
    // Profil entreprise incomplet : tâche « obligatoire » vers l'onglet entreprise.
    expect(taches[0]).toMatchObject({ id: "completude", href: "/client/profil#entreprise", priorite: "OBLIGATOIRE" });
    // Le besoin à clarifier apparaît UNE fois (via le centre d'attention).
    expect(taches.filter((x) => x.titre.includes(`Besoin A_CLARIFIER ${s}`) || x.titre.includes("clarifier"))).toHaveLength(1);
    expect(t.compteurs.donnees.actionsAFaire).toBe(taches.length);

    expect(t.completude.donnees.prochaineEtape).toBe("QUALIFICATION");
    expect(t.atlasOs).toEqual({ ok: true, donnees: { etat: "DISPONIBLE", demandeLe: null, decideLe: null, motifDecision: null } });
    const texte = JSON.stringify(t);
    expect(texte).not.toContain("Autre client");
  });

  test("activité récente : évènements réels datés, libellés métier, sans statut technique brut", async ({ request }) => {
    const { client, email, s } = await clientIsole();
    await prisma.clientNeed.create({ data: { clientId: client.id, correlationId: `lot4-act-${s}`, texteOriginal: `Besoin activité ${s}`, statut: "SOUMIS" } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "Bonjour" } });
    await connecter(request, email);
    const t = await (await request.get("/api/client/tableau-de-bord")).json();
    const libelles = t.activite.donnees.map((e: { libelle: string }) => e.libelle);
    expect(libelles).toEqual(expect.arrayContaining(["Besoin exprimé", "Message reçu de l'équipe ATLAS"]));
    expect(JSON.stringify(t.activite)).not.toMatch(/SOUMIS|ANALYSEE|A_CLARIFIER/);
  });
});
