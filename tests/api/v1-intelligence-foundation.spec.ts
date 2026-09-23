import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS V1 — Intelligence Foundation (23/09/2026). Couvre : RBAC (Admin
// uniquement, Client/Engineer refusés), le flux Research complet
// (Query -> Source -> Observation -> Verification), le lifecycle Knowledge
// (création, transition de statut, supersession), Evidence (rattachement à
// exactement un contexte, jamais Client Data -> Knowledge automatique).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerAdmin() {
  const email = `v1if-admin-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email };
}

async function creerClient() {
  const client = await prisma.client.create({ data: { nom: `V1IF Client ${suffixe()}` } });
  const email = `v1if-client-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email };
}

async function creerIngenieur() {
  const s = suffixe();
  const email = `v1if-ing-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const profil = await prisma.profil.create({ data: { nom: `Ingenieur V1IF ${s}` } });
  await prisma.user.create({ data: { email, passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id } });
  return { email };
}

test.describe("Intelligence Foundation — RBAC (Admin uniquement)", () => {
  test("Client et Engineer n'ont aucun accès aux 3 moteurs", async () => {
    const { email: emailClient } = await creerClient();
    const { email: emailIng } = await creerIngenieur();

    const ctxClient = await contexteConnecte({ email: emailClient, role: "CLIENT" });
    const ctxIng = await contexteConnecte({ email: emailIng, role: "INGENIEUR" });

    for (const ctx of [ctxClient, ctxIng]) {
      expect((await ctx.get("/api/research/queries")).status()).toBe(403);
      expect((await ctx.post("/api/research/queries", { data: { question: "x" } })).status()).toBe(403);
      expect((await ctx.get("/api/knowledge")).status()).toBe(403);
      expect((await ctx.post("/api/knowledge", { data: { title: "x", summary: "x", type: "FACT", domain: "QA" } })).status()).toBe(403);
      expect((await ctx.get("/api/evidence")).status()).toBe(403);
    }
    await ctxClient.dispose();
    await ctxIng.dispose();
  });
});

test.describe("Intelligence Foundation — Research Engine (flux complet)", () => {
  test("Query -> Source -> Observation -> Verification, statut dénormalisé mis à jour", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const repQuery = await ctx.post("/api/research/queries", {
      data: { question: "Kubernetes 1.31 est-il encore supporté ?", contexte: "Audit API V1IF" },
    });
    expect(repQuery.ok(), await repQuery.text()).toBeTruthy();
    const query = await repQuery.json();
    expect(query.statut).toBe("EN_COURS");
    expect(query.demandeParEmail).toBe(admin.email);

    const repSource = await ctx.post(`/api/research/queries/${query.id}/sources`, {
      data: { url: "https://kubernetes.io/releases/1.32", publisher: "Kubernetes", scope: "upstream" },
    });
    expect(repSource.ok(), await repSource.text()).toBeTruthy();
    const source = await repSource.json();

    const repObs = await ctx.post("/api/research/observations", {
      data: { queryId: query.id, sourceId: source.id, contenu: "K8s 1.31 EOL upstream depuis le 13/01/2026." },
    });
    expect(repObs.ok(), await repObs.text()).toBeTruthy();
    const observation = await repObs.json();
    expect(observation.statutVerification).toBe("UNVERIFIED");

    const queryApres = await (await ctx.get("/api/research/queries")).json();
    const queryMaj = queryApres.find((q: { id: string }) => q.id === query.id);
    expect(queryMaj.statut).toBe("RESULTAT_TROUVE");

    const repVerif = await ctx.post(`/api/research/observations/${observation.id}/verifications`, {
      data: { statut: "VERIFIED", methode: "source officielle unique" },
    });
    expect(repVerif.ok(), await repVerif.text()).toBeTruthy();

    const observationsApres = await (await ctx.get(`/api/research/observations?queryId=${query.id}`)).json();
    const obsMaj = observationsApres.find((o: { id: string }) => o.id === observation.id);
    expect(obsMaj.statutVerification).toBe("VERIFIED");

    const historique = await (await ctx.get(`/api/research/observations/${observation.id}/verifications`)).json();
    expect(historique.length).toBe(1);
    expect(historique[0].verifieParEmail).toBe(admin.email);

    await ctx.dispose();
  });

  test("une observation ne peut pas mélanger une source d'une autre recherche", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const q1 = await (await ctx.post("/api/research/queries", { data: { question: "Q1" } })).json();
    const q2 = await (await ctx.post("/api/research/queries", { data: { question: "Q2" } })).json();
    const sourceQ2 = await (await ctx.post(`/api/research/queries/${q2.id}/sources`, { data: { url: "https://exemple.test" } })).json();

    const repCroisee = await ctx.post("/api/research/observations", {
      data: { queryId: q1.id, sourceId: sourceQ2.id, contenu: "incohérent" },
    });
    expect(repCroisee.status()).toBe(404);

    await ctx.dispose();
  });
});

test.describe("Intelligence Foundation — Knowledge OS (lifecycle)", () => {
  test("création, transition de statut, supersession sans suppression", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const repAncienne = await ctx.post("/api/knowledge", {
      data: { title: "OWASP Top 10:2021", summary: "Ancienne édition", type: "STANDARD", domain: "Cybersecurity", version: "2021" },
    });
    expect(repAncienne.ok(), await repAncienne.text()).toBeTruthy();
    const ancienne = await repAncienne.json();
    expect(ancienne.status).toBe("DISCOVERED");
    expect(ancienne.createdByEmail).toBe(admin.email);

    const repNouvelle = await ctx.post("/api/knowledge", {
      data: { title: "OWASP Top 10:2025", summary: "Édition courante", type: "STANDARD", domain: "Cybersecurity", version: "2025" },
    });
    const nouvelle = await repNouvelle.json();

    const repSupersede = await ctx.patch(`/api/knowledge/${ancienne.id}`, {
      data: { status: "SUPERSEDED", remplaceId: nouvelle.id },
    });
    expect(repSupersede.ok(), await repSupersede.text()).toBeTruthy();

    // Jamais supprimée : toujours lisible avec son statut à jour.
    const relue = await (await ctx.get(`/api/knowledge/${ancienne.id}`)).json();
    expect(relue.status).toBe("SUPERSEDED");
    expect(relue.remplace.id).toBe(nouvelle.id);

    const listeParDomaine = await (await ctx.get("/api/knowledge?domain=Cybersecurity")).json();
    expect(listeParDomaine.length).toBeGreaterThanOrEqual(2);

    await ctx.dispose();
  });

  test("type de connaissance invalide -> 400, aucune création", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const rep = await ctx.post("/api/knowledge", {
      data: { title: "x", summary: "x", type: "PAS_UN_TYPE_VALIDE", domain: "QA" },
    });
    expect(rep.status()).toBe(400);

    await ctx.dispose();
  });
});

test.describe("Intelligence Foundation — Evidence Engine (rattachement exclusif)", () => {
  test("Evidence liée à un ServiceEngagement (contexte Client) fonctionne", async () => {
    const admin = await creerAdmin();
    const { client } = await creerClient();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const engagement = await prisma.serviceEngagement.create({ data: { clientId: client.id, titre: "Audit V1IF" } });

    const rep = await ctx.post("/api/evidence", {
      data: { type: "DOCUMENT", title: "Rapport d'audit", serviceEngagementId: engagement.id },
    });
    expect(rep.ok(), await rep.text()).toBeTruthy();
    const evidence = await rep.json();
    expect(evidence.serviceEngagementId).toBe(engagement.id);
    expect(evidence.knowledgeId).toBeNull();
    expect(evidence.researchObservationId).toBeNull();

    await ctx.dispose();
  });

  test("Evidence sans aucun contexte -> 400 (jamais orpheline)", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const rep = await ctx.post("/api/evidence", { data: { type: "OTHER", title: "Sans contexte" } });
    expect(rep.status()).toBe(400);

    await ctx.dispose();
  });

  test("Evidence avec DEUX contextes à la fois -> 400 (jamais d'ambiguïté Client/Knowledge)", async () => {
    const admin = await creerAdmin();
    const { client } = await creerClient();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const engagement = await prisma.serviceEngagement.create({ data: { clientId: client.id, titre: "Audit V1IF 2" } });
    const knowledge = await prisma.knowledge.create({
      data: { title: "K", summary: "K", type: "FACT", domain: "QA", createdByEmail: admin.email },
    });

    const rep = await ctx.post("/api/evidence", {
      data: { type: "OTHER", title: "Ambigu", serviceEngagementId: engagement.id, knowledgeId: knowledge.id },
    });
    expect(rep.status()).toBe(400);

    await ctx.dispose();
  });

  test("aucune transformation automatique Client Data -> Knowledge : créer une Evidence Client ne crée jamais de Knowledge", async () => {
    const admin = await creerAdmin();
    const { client } = await creerClient();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const avantCount = await prisma.knowledge.count();
    const engagement = await prisma.serviceEngagement.create({ data: { clientId: client.id, titre: "Audit V1IF 3" } });
    await ctx.post("/api/evidence", { data: { type: "OBSERVATION", title: "Config Client observée", serviceEngagementId: engagement.id } });
    const apresCount = await prisma.knowledge.count();

    expect(apresCount).toBe(avantCount);

    await ctx.dispose();
  });
});
