import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// REV (01/11/2026) — sondes de sécurité issues de la revue technique,
// intégrées à la suite : rôles sur toutes les routes Admin des lots (y compris
// « Demandes clients »), journalisation des refus, isolation entre clients,
// anonymisation des profils proposés, ATLAS OS, rattachement de missions.
// Données isolées et fictives.
const MDP = "Demo1234";
const QUALIF = { pays: "France", contactReferent: "Mme Revue", email: "revue@fictif.fr" };
const CONTRAT = { formeJuridique: "SAS", identifiantEntreprise: "000 (fictif)", adresseSiege: "Adresse fictive", fonctionContact: "DSI" };
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function contexte(email?: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  if (email) {
    const r = await ctx.post("/api/auth/login", { data: { email, password: MDP } });
    expect(r.ok(), `connexion ${email}`).toBeTruthy();
  }
  return ctx;
}

async function clientIsole(nom: string) {
  const s = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const client = await prisma.client.create({ data: { nom: `${nom} ${s}`, ...QUALIF, ...CONTRAT } });
  const email = `revue-${s}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email };
}

test.describe.configure({ mode: "serial" });

test("Revue — rôles : routes Admin des lots refusées à anonyme, Client et Ingénieur, refus journalisés", async () => {
  const debut = new Date(Date.now() - 2000);
  const b = await clientIsole("Client B");
  const ctxB = await contexte(b.email);
  const cree = await ctxB.post("/api/client/projets", { data: { type: "DELIVERY", titre: "Projet B", objectif: "Objectif B", resultatAttendu: "Résultat B" } });
  expect(cree.status(), await cree.text()).toBe(201);
  const projetB = (await cree.json()).id as string;
  const needB = (await prisma.projet.findUniqueOrThrow({ where: { id: projetB } })).needId;

  const routesAdmin: [string, string, unknown?][] = [
    ["GET", "/api/projets"],
    ["GET", `/api/projets/${projetB}`],
    ["PATCH", `/api/projets/${projetB}`, { statut: "ABANDONNE", motif: "x" }],
    ["POST", `/api/projets/${projetB}/propositions`, { niveau: "INDICATIVE" }],
    ["POST", `/api/projets/${projetB}/missions`, { missionId: "x" }],
    ["GET", "/api/atlas-os/activations"],
    ["PATCH", `/api/atlas-os/activations/${b.client.id}`, { statut: "ACTIVEE" }],
    ["GET", `/api/talent/besoins/${needB}/actions-client`],
    ["PATCH", "/api/talent/actions-client/inexistant", { statut: "PRISE_EN_CHARGE" }],
    ["GET", "/api/admin/demandes-clients"],
    ["PATCH", "/api/admin/demandes-clients/TALENT/inexistant", { statut: "CLOTUREE" }],
  ];
  const autreClient = await clientIsole("Client A");
  const acteurs: [string, APIRequestContext][] = [
    ["anonyme", await contexte()],
    ["client", await contexte(autreClient.email)],
    ["ingenieur-demo", await contexte("ingenieur-demo@example.com")],
  ];
  const fuites: string[] = [];
  for (const [nom, ctx] of acteurs) {
    for (const [m, url, data] of routesAdmin) {
      const r = await ctx.fetch(url, { method: m, data, maxRedirects: 0 });
      if (r.status() < 400 || r.status() >= 500) fuites.push(`${nom} ${m} ${url} -> ${r.status()}`);
    }
  }
  expect(fuites, fuites.join("\n")).toEqual([]);
  // Chaque refus opposé à un utilisateur CONNECTÉ est journalisé.
  expect(await prisma.evenementSecurite.count({ where: { action: "rbac.acces_refuse", acteurEmail: autreClient.email } })).toBe(routesAdmin.length);
  expect(
    await prisma.evenementSecurite.count({ where: { action: "rbac.acces_refuse", acteurEmail: "ingenieur-demo@example.com", contexteRoute: "/api/projets/[id]", createdAt: { gte: debut } } })
  ).toBeGreaterThanOrEqual(2);
  // Le projet B n'a pas été modifié par ces tentatives.
  expect((await prisma.projet.findUniqueOrThrow({ where: { id: projetB } })).statut).toBe("A_QUALIFIER");
});

test("Revue — isolation : client-demo ne lit ni ne modifie les objets du Client B", async () => {
  const b = await clientIsole("Client B2");
  const ctxB = await contexte(b.email);
  const projetB = (await (await ctxB.post("/api/client/projets", { data: { type: "DELIVERY", titre: "Projet B2", objectif: "o", resultatAttendu: "r" } })).json()).id as string;
  const needB = (await prisma.projet.findUniqueOrThrow({ where: { id: projetB } })).needId;
  await prisma.clientNeed.update({ where: { id: needB }, data: { statut: "VALIDE" } });
  await ctxB.post("/api/client/atlas-os", { data: { motif: "test" } });

  const clientA = await clientIsole("Client A2");
  const a = await contexte(clientA.email);
  const essais: [string, string, unknown][] = [
    ["PATCH", `/api/client/projets/${projetB}`, { perimetre: "intrusion" }],
    ["POST", `/api/client/projets/${projetB}/actions`, { action: "ABANDONNER" }],
    ["POST", `/api/client/projets/${projetB}/actions`, { action: "DEMANDE_PRECISION", message: "intrusion" }],
    ["POST", "/api/client/talents/actions", { needId: needB, type: "AUTRES_PROFILS" }],
    ["POST", `/api/client/besoins/${needB}/faits`, { action: "AJOUTER", cle: "COMPETENCE", valeur: "Java" }],
  ];
  const fuites: string[] = [];
  for (const [m, url, data] of essais) {
    const r = await a.fetch(url, { method: m, data });
    if (r.status() < 400) fuites.push(`${m} ${url} -> ${r.status()}`);
  }
  expect(fuites, fuites.join("\n")).toEqual([]);
  const projet = await prisma.projet.findUniqueOrThrow({ where: { id: projetB } });
  expect(projet.perimetre).toBeNull();
  expect(projet.statut).toBe("A_QUALIFIER");
  expect(await prisma.actionTalentClient.count({ where: { needId: needB } })).toBe(0);
  // Les listes de client-demo ne contiennent rien du Client B.
  for (const url of ["/api/client/projets", "/api/client/talents", "/api/client/tableau-de-bord", "/api/client/atlas-os"]) {
    const corps = await (await a.get(url)).text();
    expect(corps, url).not.toContain(projetB);
    expect(corps, url).not.toContain(needB);
    expect(corps, url).not.toContain(b.client.id);
  }
});

test("Revue — anonymisation : /api/client/talents n'expose aucun identifiant, nom ou e-mail d'ingénieur ; 5 profils au plus", async () => {
  const c = await clientIsole("Client anonymisation");
  const suffixe = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const competence = `CompAnon${suffixe}`;
  const profils = [];
  for (let i = 0; i < 7; i++) {
    profils.push(
      await prisma.profil.create({
        data: { nom: `NomSecret${suffixe}${i}`, prenom: `PrenomSecret${suffixe}`, cvValide: true, competences: [competence], competencesGraph: { create: [{ competence, statut: "VERIFIE", confiance: "HAUTE" }] }, seniorite: "Senior", anneesExperience: 5, tjmEstime: 777, disponibilite: "Disponible immédiatement" },
      })
    );
  }
  const besoins = [];
  for (let i = 0; i < 2; i++) {
    besoins.push(await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `anon-${i}-${suffixe}`, texteOriginal: `Besoin ${i}`, statut: "VALIDE", faits: { create: [{ cle: "COMPETENCE", valeur: competence, statut: "DECLARE" }] } } }));
  }
  const a = await contexte(c.email);
  const maj = await a.post("/api/client/talents/actualiser", { data: { needIds: besoins.map((b) => b.id) } });
  expect(maj.ok()).toBeTruthy();
  for (const corps of [await maj.text(), await (await a.get("/api/client/talents")).text()]) {
    expect(corps).not.toMatch(/"profilId"/);
    for (const p of profils) {
      expect(corps).not.toContain(p.id);
      expect(corps).not.toContain(p.nom);
    }
    expect(corps).not.toContain(`PrenomSecret${suffixe}`);
    expect(corps).not.toMatch(/[^a-z0-9]777[^a-z0-9]/i);
    const json = JSON.parse(corps);
    expect(json.besoins).toHaveLength(2);
    for (const b of json.besoins) expect(b.profils).toHaveLength(5);
  }
});

test("Revue — Admin : rattacher la mission d'un AUTRE client à un projet est refusé", async () => {
  const b = await clientIsole("Client B3");
  const ctxB = await contexte(b.email);
  const projetB = (await (await ctxB.post("/api/client/projets", { data: { type: "DELIVERY", titre: "Projet B3", objectif: "o", resultatAttendu: "r" } })).json()).id as string;
  const missionAutre = await prisma.mission.findFirst({ where: { clientId: { not: b.client.id } }, select: { id: true } });
  test.skip(!missionAutre, "aucune mission d'un autre client dans la base");
  const admin = await contexte("admin-demo@example.com");
  const r = await admin.post(`/api/projets/${projetB}/missions`, { data: { missionId: missionAutre!.id } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(await prisma.mission.findUniqueOrThrow({ where: { id: missionAutre!.id }, select: { projetId: true } })).toMatchObject({ projetId: null });
});

test("Revue — ATLAS OS : un Client ne peut pas s'auto-activer", async () => {
  const b = await clientIsole("Client B4");
  const ctxB = await contexte(b.email);
  await ctxB.post("/api/client/atlas-os", { data: { motif: "x" } });
  const r = await ctxB.patch(`/api/atlas-os/activations/${b.client.id}`, { data: { statut: "ACTIVEE" } });
  expect(r.status()).toBe(403);
  expect((await prisma.activationAtlasOs.findUniqueOrThrow({ where: { clientId: b.client.id } })).statut).toBe("DEMANDEE");
  const projet = await ctxB.post("/api/client/projets", { data: { type: "SERVICE_ATLAS_OS", titre: "t", objectif: "o", resultatAttendu: "r" } });
  expect(projet.status()).toBe(403);
});
