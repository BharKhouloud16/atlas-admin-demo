import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { creerProfilIsole } from "../setup/donnees-isolees";

// LOT 6 (28/10/2026) — projets complets, de la qualification à la mission :
// complétude, ATLAS OS, propositions indicative puis vérifiée, acceptation
// réservée aux propositions vérifiées, engagement par l'Admin, missions
// existantes rattachées, isolation entre clients.

const MDP = "Demo1234";
const QUALIF = { pays: "France", contactReferent: "Mme Martin", email: "contact@fictif.fr" };
const CONTRAT = { formeJuridique: "SAS", identifiantEntreprise: "000 (fictif)", adresseSiege: "Adresse fictive", fonctionContact: "Directrice technique" };

async function clientIsole(champs: Record<string, string> = {}) {
  const s = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const client = await prisma.client.create({ data: { nom: `Client lot6 ${s}`, ...champs } });
  const email = `client-lot6-${s}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email, s };
}

async function connecter(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/login", { data: { email, password: MDP } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

const SAISIE = {
  type: "DELIVERY",
  titre: "Automatisation des tests de la plateforme e-commerce",
  objectif: "Réduire les régressions avant chaque mise en production.",
  resultatAttendu: "Une suite Playwright exécutée en CI couvrant les parcours d'achat.",
};

test.describe("LOT 6 — projets complets", () => {
  test("création refusée sans les informations de qualification du profil entreprise", async ({ request }) => {
    const { email } = await clientIsole();
    await connecter(request, email);
    const r = await request.post("/api/client/projets", { data: SAISIE });
    expect(r.status()).toBe(409);
    expect((await r.json()).manquants).toEqual(["Pays d'immatriculation", "Interlocuteur principal", "E-mail ou téléphone de contact"]);
  });

  test("prestation ATLAS OS refusée tant que le module n'est pas activé", async ({ request }) => {
    const { email } = await clientIsole(QUALIF);
    await connecter(request, email);
    expect((await request.post("/api/client/projets", { data: { ...SAISIE, type: "SERVICE_ATLAS_OS" } })).status()).toBe(403);
  });

  test("cycle complet : qualification, indicative, vérifiée, acceptation, engagement, mission", async ({ request }) => {
    const { client, email } = await clientIsole(QUALIF);
    await connecter(request, email);

    const creation = await request.post("/api/client/projets", { data: { ...SAISIE, exigencesTechniques: "Playwright, TypeScript, GitLab CI" } });
    expect(creation.status(), await creation.text()).toBe(201);
    const { id } = await creation.json();
    let projet = (await (await request.get("/api/client/projets")).json()).projets[0];
    expect(projet).toMatchObject({ id, statut: "A_QUALIFIER" });
    expect(projet.manquants.requises).toEqual(["Périmètre (ce qui est inclus et exclu)", "Calendrier souhaité"]);
    expect(projet.competencesIdentifiees).toEqual(expect.arrayContaining(["Playwright"]));
    // Même moteur que les besoins : le projet est adossé à un ClientNeed.
    const lien = await prisma.projet.findUnique({ where: { id }, select: { need: { select: { faits: { where: { cle: "OBJECTIF" } } } } } });
    expect(lien!.need.faits[0].valeur).toBe(SAISIE.objectif);

    // L'Admin ne peut pas qualifier un projet incomplet.
    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/projets/${id}`, { data: { statut: "QUALIFIE" } })).status()).toBe(409);

    await connecter(request, email);
    expect((await request.patch(`/api/client/projets/${id}`, { data: { perimetre: "Web et API, hors application mobile", calendrierSouhaite: "Janvier à juin 2027" } })).status()).toBe(200);

    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/projets/${id}`, { data: { statut: "QUALIFIE" } })).status()).toBe(200);
    const indicative = {
      niveau: "INDICATIVE",
      approche: "Cadrage, socle d'automatisation, extension par parcours",
      perimetre: "Parcours d'achat web et API de commande",
      equipe: [{ role: "Ingénieur QA automation", nombre: 2, competences: ["Playwright"] }],
      etapes: [{ nom: "Cadrage", livrables: ["Stratégie de test"], dureeEstimee: "2 semaines" }],
      hypotheses: [],
    };
    expect((await request.post(`/api/projets/${id}/propositions`, { data: indicative })).status()).toBe(400);
    expect((await request.post(`/api/projets/${id}/propositions`, { data: { ...indicative, hypotheses: ["Environnement de recette disponible"] } })).status()).toBe(201);

    await connecter(request, email);
    projet = (await (await request.get("/api/client/projets")).json()).projets[0];
    expect(projet.statut).toBe("PROPOSITION_INDICATIVE");
    const v1 = projet.propositions[0];
    // Une estimation indicative ne s'accepte pas : on manifeste son intérêt.
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "ACCEPTER", propositionId: v1.id } })).status()).toBe(409);
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "INTERET", propositionId: v1.id } })).status()).toBe(200);
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "DEMANDE_PRECISION", propositionId: v1.id } })).status()).toBe(400);
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "DEMANDE_PRECISION", propositionId: v1.id, message: "Inclure l'API de paiement ?" } })).status()).toBe(200);

    await connecter(request, "admin-demo@example.com");
    expect((await request.post(`/api/projets/${id}/propositions`, { data: { ...indicative, niveau: "VERIFIEE" } })).status()).toBe(400);
    const verifiee = await request.post(`/api/projets/${id}/propositions`, {
      data: { ...indicative, niveau: "VERIFIEE", delaiEstime: "5 mois", budgetEstimeMin: 60000, budgetEstimeMax: 72000, hypotheses: ["Démarrage le 4 janvier 2027"] },
    });
    expect(verifiee.status()).toBe(201);
    expect((await verifiee.json()).version).toBe(2);

    await connecter(request, email);
    projet = (await (await request.get("/api/client/projets")).json()).projets[0];
    expect(projet.statut).toBe("PROPOSITION_VERIFIEE");
    expect(projet.propositions.map((x: { version: number; statut: string }) => `${x.version}:${x.statut}`)).toEqual(["2:PUBLIEE", "1:REMPLACEE"]);
    const v2 = projet.propositions[0];
    // Acceptation = engagement à venir : profil entreprise de contractualisation requis.
    const refus = await request.post(`/api/client/projets/${id}/actions`, { data: { action: "ACCEPTER", propositionId: v2.id } });
    expect(refus.status()).toBe(409);
    expect((await refus.json()).manquants.length).toBeGreaterThan(0);
    await request.fetch("/api/client/profil", { method: "PATCH", data: CONTRAT });
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "ACCEPTER", propositionId: v2.id } })).status()).toBe(200);
    projet = (await (await request.get("/api/client/projets")).json()).projets[0];
    expect(projet.statut).toBe("ACCEPTEE");

    // Aucune mission n'a été créée automatiquement.
    expect(await prisma.mission.count({ where: { projetId: id } })).toBe(0);

    await connecter(request, "admin-demo@example.com");
    // REV-03 : profil Ingénieur DÉDIÉ au test (jamais un profil partagé).
    const profil = await creerProfilIsole();
    const mission = await prisma.mission.create({ data: { clientId: client.id, profilId: profil.id, nbJours: 20, tjmVente: 600, repere: `LOT6-${Date.now()}` } });
    expect((await request.post(`/api/projets/${id}/missions`, { data: { missionId: mission.id } })).status()).toBe(409);
    expect((await request.patch(`/api/projets/${id}`, { data: { statut: "ENGAGEMENT_CONFIRME" } })).status()).toBe(200);
    expect((await request.post(`/api/projets/${id}/missions`, { data: { missionId: mission.id } })).status()).toBe(200);
    expect((await prisma.projet.findUnique({ where: { id } }))!.statut).toBe("EN_COURS");
    expect((await request.patch(`/api/projets/${id}`, { data: { statut: "TERMINE" } })).status()).toBe(200);

    const evenements = await prisma.evenementProjet.findMany({ where: { projetId: id }, orderBy: { createdAt: "asc" } });
    expect(evenements.map((e) => e.type)).toEqual([
      "CREATION",
      "COMPLEMENT_CLIENT",
      "STATUT_QUALIFIE",
      "PROPOSITION_INDICATIVE_PUBLIEE",
      "INTERET_MANIFESTE",
      "DEMANDE_PRECISION",
      "PROPOSITION_VERIFIEE_PUBLIEE",
      "PROPOSITION_ACCEPTEE",
      "STATUT_ENGAGEMENT_CONFIRME",
      "MISSION_RATTACHEE",
      "STATUT_TERMINE",
    ]);
  });

  test("isolation : un client ne voit ni ne modifie le projet d'un autre ; l'API Admin lui est fermée", async ({ request }) => {
    const a = await clientIsole(QUALIF);
    const b = await clientIsole(QUALIF);
    await connecter(request, a.email);
    const { id } = await (await request.post("/api/client/projets", { data: SAISIE })).json();
    await connecter(request, b.email);
    expect((await (await request.get("/api/client/projets")).json()).projets).toEqual([]);
    expect((await request.patch(`/api/client/projets/${id}`, { data: { perimetre: "x" } })).status()).toBe(404);
    expect((await request.post(`/api/client/projets/${id}/actions`, { data: { action: "ABANDONNER" } })).status()).toBe(404);
    expect((await request.get("/api/projets")).status()).toBe(403);
    expect((await request.get(`/api/projets/${id}`)).status()).toBe(403);
  });

  test("une mission d'un autre client ne se rattache jamais au projet", async ({ request }) => {
    const a = await clientIsole({ ...QUALIF, ...CONTRAT });
    const autre = await clientIsole();
    await connecter(request, a.email);
    const { id } = await (await request.post("/api/client/projets", { data: SAISIE })).json();
    await prisma.projet.update({ where: { id }, data: { statut: "ENGAGEMENT_CONFIRME" } });
    const profil = await creerProfilIsole();
    const missionAutre = await prisma.mission.create({ data: { clientId: autre.client.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
    await connecter(request, "admin-demo@example.com");
    expect((await request.post(`/api/projets/${id}/missions`, { data: { missionId: missionAutre.id } })).status()).toBe(404);
  });
});
