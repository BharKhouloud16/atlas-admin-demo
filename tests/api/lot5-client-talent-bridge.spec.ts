import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
// Couvre GET /api/talent/besoins(/[id]) et POST .../creer-demande — accès
// Admin uniquement, éligibilité (statut VALIDE), anti-doublon/concurrence
// via la contrainte @unique sur sourceNeedId, clientId dérivé exclusivement
// du besoin (jamais du corps), non-consommation silencieuse d'un fait
// INFERE, et exposition minimale côté client (GET /api/client/besoins).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerBesoinValide(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  const need = await prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `lot5-${suffixe}`,
      texteOriginal: `Besoin de test LOT5 ${suffixe}`,
      statut: "VALIDE",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
  });
  return need;
}

test.describe("COMPANY ATLAS LOT 5 — Client Intelligence → Talent Bridge (API)", () => {
  test.describe("GET /api/talent/besoins — liste Admin", () => {
    test("un ADMIN voit un besoin qu'il vient de créer via fixture, avec son état de liaison", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      const liste = await request.get("/api/talent/besoins");
      expect(liste.ok()).toBeTruthy();
      const { besoins } = await liste.json();
      const trouve = besoins.find((b: { id: string }) => b.id === need.id);
      expect(trouve).toBeTruthy();
      expect(trouve.demandeTalentCreee).toBeNull();
    });

    test("non authentifié -> 403", async ({ request }) => {
      const reponse = await request.get("/api/talent/besoins");
      expect(reponse.status()).toBe(403);
    });

    test("CLIENT / INGENIEUR -> 403 (réservé Admin)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      expect((await request.get("/api/talent/besoins")).status()).toBe(403);

      await connecter(request, "ingenieur-demo@example.com");
      expect((await request.get("/api/talent/besoins")).status()).toBe(403);
    });
  });

  test.describe("GET /api/talent/besoins/[id] — détail Admin", () => {
    test("besoin inexistant -> 404", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const reponse = await request.get("/api/talent/besoins/inexistant-xyz");
      expect(reponse.status()).toBe(404);
    });

    test("agrège besoin + client + profil du BON client, jamais celui d'un autre", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");

      const creationClientA = await request.post("/api/clients", { data: { nom: `Client LOT5 A ${Date.now()}` } });
      const clientA = await creationClientA.json();
      const creationClientB = await request.post("/api/clients", { data: { nom: `Client LOT5 B ${Date.now()}` } });
      const clientB = await creationClientB.json();

      const profilA = await prisma.clientProfile.create({ data: { clientId: clientA.id } });
      await prisma.clientProfileFact.create({
        data: { profileId: profilA.id, cle: "ENJEU", valeur: "Enjeu propre au client A", statut: "DECLARE", source: "client" },
      });
      const profilB = await prisma.clientProfile.create({ data: { clientId: clientB.id } });
      await prisma.clientProfileFact.create({
        data: { profileId: profilB.id, cle: "ENJEU", valeur: "Enjeu propre au client B — ne doit jamais apparaître", statut: "DECLARE", source: "client" },
      });

      const needA = await creerBesoinValide(clientA.id, [{ cle: "ROLE", valeur: "QA Automation", statut: "DECLARE" }]);

      const detail = await request.get(`/api/talent/besoins/${needA.id}`);
      expect(detail.ok(), await detail.text()).toBeTruthy();
      const donnees = await detail.json();
      expect(donnees.client.id).toBe(clientA.id);
      expect(donnees.profilFaitsActifs.some((f: { valeur: string }) => f.valeur === "Enjeu propre au client A")).toBe(true);
      expect(donnees.profilFaitsActifs.some((f: { valeur: string }) => f.valeur.includes("client B"))).toBe(false);
      expect(donnees.eligibilite).toEqual({ eligible: true, raison: null });
      expect(donnees.suggestion.titreSuggere).toEqual({ valeur: "QA Automation", statut: "DECLARE" });
    });

    test("non authentifié / mauvais rôle -> 403", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      expect((await request.get(`/api/talent/besoins/${need.id}`)).status()).toBe(403);

      await connecter(request, "client-demo@example.com");
      expect((await request.get(`/api/talent/besoins/${need.id}`)).status()).toBe(403);
    });
  });

  test.describe("POST /api/talent/besoins/[id]/creer-demande", () => {
    test("besoin VALIDE -> 201, DemandeTalent créée avec sourceNeedId, clientId dérivé du besoin, aucun score inventé", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id, [{ cle: "ROLE", valeur: "Lead QA", statut: "DECLARE" }]);

      const creation = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, {
        data: { description: "Besoin détaillé et relu par l'Admin avant création.", clientId: "id-falsifie-ne-doit-jamais-etre-utilise" },
      });
      expect(creation.status(), await creation.text()).toBe(201);
      const demande = await creation.json();
      expect(demande.clientId).toBe(client!.id);
      expect(demande.analyseProvider).toBe("client-need-bridge");
      expect(demande.analyseConfiance).toBeNull();

      const relu = await prisma.demandeTalent.findUnique({ where: { id: demande.id } });
      expect(relu?.sourceNeedId).toBe(need.id);
    });

    test("besoin non VALIDE (SOUMIS) -> 400, aucune DemandeTalent créée", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `lot5-incomplet-${Date.now()}`, texteOriginal: "Besoin encore incomplet.", statut: "SOUMIS" },
      });

      const tentative = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Tentative prématurée." } });
      expect(tentative.status()).toBe(400);
      const corps = await tentative.json();
      expect(corps.error).toContain("SOUMIS");

      const compte = await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } });
      expect(compte).toBe(0);
    });

    test("un fait INFERE du besoin source n'est jamais transformé en VERIFIE par la création", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id, [{ cle: "SENIORITE", valeur: "Senior", statut: "INFERE" }]);

      const creation = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, {
        data: { description: "Besoin relu, séniorité déduite non confirmée par le client.", senioriteSouhaitee: "Senior" },
      });
      expect(creation.status()).toBe(201);

      const faitOriginal = await prisma.clientNeedFait.findFirst({ where: { needId: need.id, cle: "SENIORITE" } });
      expect(faitOriginal?.statut).toBe("INFERE"); // jamais réécrit par la création de la DemandeTalent
    });

    test("double création (même besoin) -> la seconde échoue 409 avec l'id de la demande existante, une seule ligne en base", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      const premiere = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Première création, valide." } });
      expect(premiere.status()).toBe(201);
      const { id: premiereId } = await premiere.json();

      const seconde = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Tentative de doublon (double-clic)." } });
      expect(seconde.status()).toBe(409);
      const corps = await seconde.json();
      expect(corps.demandeTalentId).toBe(premiereId);

      const compte = await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } });
      expect(compte).toBe(1);
    });

    test("concurrence — deux créations simultanées pour le même besoin produisent exactement une DemandeTalent", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      const [a, b] = await Promise.all([
        request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Tentative concurrente A." } }),
        request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Tentative concurrente B." } }),
      ]);
      const statuts = [a.status(), b.status()].sort();
      expect(statuts).toEqual([201, 409]);

      const compte = await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } });
      expect(compte).toBe(1);
    });

    test("besoin inexistant -> 404", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const reponse = await request.post("/api/talent/besoins/inexistant-xyz/creer-demande", { data: { description: "Peu importe." } });
      expect(reponse.status()).toBe(404);
    });

    test("non authentifié -> 403, aucune écriture", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      const reponse = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Sans session." } });
      expect(reponse.status()).toBe(403);
      expect(await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } })).toBe(0);
    });

    test("CLIENT / INGENIEUR -> 403, aucune écriture", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      await connecter(request, "client-demo@example.com");
      expect((await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Un client ne peut pas." } })).status()).toBe(403);

      await connecter(request, "ingenieur-demo@example.com");
      expect((await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "Un ingénieur ne peut pas." } })).status()).toBe(403);

      expect(await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } })).toBe(0);
    });

    test("description trop courte -> 400, aucune écriture (validation réutilisée, jamais dupliquée)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);

      const reponse = await request.post(`/api/talent/besoins/${need.id}/creer-demande`, { data: { description: "court" } });
      expect(reponse.status()).toBe(400);
      expect(await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } })).toBe(0);
    });
  });

  test.describe("GET /api/client/besoins — statut dérivé côté client", () => {
    test("demarcheTalentEngagee passe à true une fois la DemandeTalent créée, sans exposer de donnée interne", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const creation = await request.post("/api/client/besoins", { data: { texteOriginal: `Besoin LOT5 statut client ${Date.now()}` } });
      expect(creation.status()).toBe(201);
      const { besoin } = await creation.json();

      const avant = await request.get("/api/client/besoins");
      const { besoins: besoinsAvant } = await avant.json();
      const trouveAvant = besoinsAvant.find((b: { id: string }) => b.id === besoin.id);
      expect(trouveAvant.demarcheTalentEngagee).toBe(false);
      expect(trouveAvant).not.toHaveProperty("demandeTalentCreee");

      await prisma.clientNeed.update({ where: { id: besoin.id }, data: { statut: "VALIDE" } });
      await connecter(request, "admin-demo@example.com");
      const bridge = await request.post(`/api/talent/besoins/${besoin.id}/creer-demande`, { data: { description: "Création admin pour vérifier le retour client." } });
      expect(bridge.status()).toBe(201);

      await connecter(request, "client-demo@example.com");
      const apres = await request.get("/api/client/besoins");
      const { besoins: besoinsApres } = await apres.json();
      const trouveApres = besoinsApres.find((b: { id: string }) => b.id === besoin.id);
      expect(trouveApres.demarcheTalentEngagee).toBe(true);
      expect(trouveApres).not.toHaveProperty("demandeTalentCreee");
    });
  });
});
