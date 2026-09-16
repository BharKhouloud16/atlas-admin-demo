import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 6 : Mission Context Bridge (16/09/2026).
// Couvre POST/GET /api/missions (extension LOT 6) — sourceDemandeId,
// dateDebut/dateFin/modeTravail, dérivation stricte du clientId,
// cardinalité 1 demande -> N missions, concurrence, provenance intacte,
// et le champ dérivé missionEnCours sur GET /api/client/besoins.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Ingénieur Test LOT6 ${suffixe}` } });
}

async function creerDemande(clientId: string, extra: Record<string, unknown> = {}) {
  const suffixe = Date.now() + Math.random();
  return prisma.demandeTalent.create({
    data: { clientId, description: `Demande de test LOT6 ${suffixe}`, ...extra },
  });
}

test.describe("COMPANY ATLAS LOT 6 — Mission Context Bridge (API)", () => {
  test.describe("POST /api/missions — sourceDemandeId", () => {
    test("crée la mission avec clientId dérivé de la demande, dateDebut/modeTravail par défaut depuis la demande", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const demande = await creerDemande(client!.id, {
        dateDebutSouhaitee: new Date("2026-12-01T00:00:00.000Z"),
        mobilite: "Remote",
      });

      const creation = await request.post("/api/missions", {
        data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 20, tjmVente: 600 },
      });
      expect(creation.status(), await creation.text()).toBe(201);
      const mission = await creation.json();
      expect(mission.clientId).toBe(client!.id);
      expect(mission.sourceDemandeId).toBe(demande.id);
      expect(new Date(mission.dateDebut).toISOString()).toBe("2026-12-01T00:00:00.000Z");
      expect(mission.modeTravail).toBe("Remote");
    });

    test("clientId fourni dans le body est structurellement ignoré quand sourceDemandeId est donné", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const creationClient = await request.post("/api/clients", { data: { nom: `Client LOT6 Spoof ${Date.now()}` } });
      const autreClient = await creationClient.json();
      const profil = await creerProfil();
      const demande = await creerDemande(client!.id);

      const creation = await request.post("/api/missions", {
        data: { sourceDemandeId: demande.id, clientId: autreClient.id, profilId: profil.id, nbJours: 10, tjmVente: 500 },
      });
      expect(creation.status(), await creation.text()).toBe(201);
      const mission = await creation.json();
      expect(mission.clientId).toBe(client!.id);
      expect(mission.clientId).not.toBe(autreClient.id);
    });

    test("dateDebut/modeTravail explicites l'emportent sur la suggestion de la demande", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const demande = await creerDemande(client!.id, { dateDebutSouhaitee: new Date("2026-12-01"), mobilite: "Remote" });

      const creation = await request.post("/api/missions", {
        data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 500, dateDebut: "2027-01-15", modeTravail: "Sur site" },
      });
      expect(creation.status(), await creation.text()).toBe(201);
      const mission = await creation.json();
      expect(new Date(mission.dateDebut).toISOString().slice(0, 10)).toBe("2027-01-15");
      expect(mission.modeTravail).toBe("Sur site");
    });

    test("sourceDemandeId inexistant -> 404, aucune mission créée", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const profil = await creerProfil();
      const reponse = await request.post("/api/missions", {
        data: { sourceDemandeId: "inexistant-xyz", profilId: profil.id, nbJours: 5, tjmVente: 500 },
      });
      expect(reponse.status()).toBe(404);
      expect(await prisma.mission.count({ where: { profilId: profil.id } })).toBe(0);
    });

    test("modeTravail hors vocabulaire fermé -> 400", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const reponse = await request.post("/api/missions", {
        data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500, modeTravail: "Full remote" },
      });
      expect(reponse.status()).toBe(400);
    });

    test("dateDebut invalide -> 400, aucune mission créée", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const reponse = await request.post("/api/missions", {
        data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500, dateDebut: "pas-une-date" },
      });
      expect(reponse.status()).toBe(400);
      expect(await prisma.mission.count({ where: { profilId: profil.id } })).toBe(0);
    });

    test("cardinalité : une même demande peut produire plusieurs missions (jamais 1 demande = 1 mission imposé)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profilA = await creerProfil();
      const profilB = await creerProfil();
      const demande = await creerDemande(client!.id);

      const premiere = await request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profilA.id, nbJours: 10, tjmVente: 500 } });
      const seconde = await request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profilB.id, nbJours: 15, tjmVente: 550 } });
      expect(premiere.status()).toBe(201);
      expect(seconde.status()).toBe(201);

      const nb = await prisma.mission.count({ where: { sourceDemandeId: demande.id } });
      expect(nb).toBe(2);
    });

    test("concurrence : deux créations simultanées depuis la même demande réussissent toutes les deux", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profilA = await creerProfil();
      const profilB = await creerProfil();
      const demande = await creerDemande(client!.id);

      const [a, b] = await Promise.all([
        request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profilA.id, nbJours: 10, tjmVente: 500 } }),
        request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profilB.id, nbJours: 10, tjmVente: 500 } }),
      ]);
      expect(a.status()).toBe(201);
      expect(b.status()).toBe(201);
      expect(await prisma.mission.count({ where: { sourceDemandeId: demande.id } })).toBe(2);
    });

    test("provenance : la DemandeTalent source n'est jamais modifiée par la création d'une Mission", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const demande = await creerDemande(client!.id, { mobilite: "Hybride", statut: "SOUMISE" });

      await request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 500, modeTravail: "Sur site" } });

      const demandeRelue = await prisma.demandeTalent.findUnique({ where: { id: demande.id } });
      expect(demandeRelue?.mobilite).toBe("Hybride"); // jamais réécrite par la Mission
      expect(demandeRelue?.statut).toBe("SOUMISE");
    });

    test("non authentifié / mauvais rôle -> 403, aucune mission créée", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();

      const sansSession = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
      expect(sansSession.status()).toBe(403);

      await connecter(request, "client-demo@example.com");
      const commeClient = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
      expect(commeClient.status()).toBe(403);

      await connecter(request, "ingenieur-demo@example.com");
      const commeIngenieur = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
      expect(commeIngenieur.status()).toBe(403);

      expect(await prisma.mission.count({ where: { profilId: profil.id } })).toBe(0);
    });

    test("comportement existant préservé : création sans sourceDemandeId (clientId direct) continue de fonctionner", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const creation = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 8, tjmVente: 450 } });
      expect(creation.status(), await creation.text()).toBe(201);
      const mission = await creation.json();
      expect(mission.sourceDemandeId).toBeNull();
      expect(mission.dateDebut).toBeNull();
      expect(mission.modeTravail).toBeNull();
    });
  });

  test.describe("GET /api/missions — sourceDemande minimal, isolation par rôle", () => {
    test("ADMIN voit sourceDemande (id + titre uniquement)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const demande = await creerDemande(client!.id, { titre: "Titre demande LOT6" });
      const creation = await request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
      const { id: missionId } = await creation.json();

      const liste = await request.get("/api/missions");
      const missions = await liste.json();
      const trouvee = missions.find((m: { id: string }) => m.id === missionId);
      expect(trouvee.sourceDemande).toEqual({ id: demande.id, titre: "Titre demande LOT6" });
    });

    test("INGENIEUR voit dateDebut/modeTravail de sa mission mais jamais sourceDemande ni les tarifs", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const ingenieur = await prisma.profil.findFirst({ where: { compte: { email: "ingenieur-demo@example.com" } } });
      const demande = await creerDemande(client!.id, { titre: "Confidentiel" });
      const creation = await request.post("/api/missions", {
        data: { sourceDemandeId: demande.id, profilId: ingenieur!.id, nbJours: 5, tjmVente: 999, dateDebut: "2027-02-01", modeTravail: "Remote" },
      });
      expect(creation.status(), await creation.text()).toBe(201);

      await connecter(request, "ingenieur-demo@example.com");
      const liste = await request.get("/api/missions");
      const missions = await liste.json();
      const mission = missions[0];
      expect(mission.dateDebut).toBeTruthy();
      expect(mission.modeTravail).toBe("Remote");
      expect(mission).not.toHaveProperty("sourceDemande");
      expect(mission).not.toHaveProperty("tjmVente");
    });
  });

  test.describe("GET /api/client/besoins — missionEnCours", () => {
    test("passe à true une fois qu'une Mission a été créée depuis la demande liée au besoin, sans exposer de donnée interne", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const creationBesoin = await request.post("/api/client/besoins", { data: { texteOriginal: `Besoin LOT6 mission ${Date.now()}` } });
      const { besoin } = await creationBesoin.json();
      await prisma.clientNeed.update({ where: { id: besoin.id }, data: { statut: "VALIDE" } });

      await connecter(request, "admin-demo@example.com");
      const bridge = await request.post(`/api/talent/besoins/${besoin.id}/creer-demande`, { data: { description: "Description suffisamment longue pour LOT6." } });
      expect(bridge.status(), await bridge.text()).toBe(201);
      const demande = await bridge.json();

      await connecter(request, "client-demo@example.com");
      const avant = await request.get("/api/client/besoins");
      const { besoins: avantListe } = await avant.json();
      expect(avantListe.find((b: { id: string }) => b.id === besoin.id).missionEnCours).toBe(false);

      await connecter(request, "admin-demo@example.com");
      const profil = await creerProfil();
      await request.post("/api/missions", { data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });

      await connecter(request, "client-demo@example.com");
      const apres = await request.get("/api/client/besoins");
      const { besoins: apresListe } = await apres.json();
      const trouve = apresListe.find((b: { id: string }) => b.id === besoin.id);
      expect(trouve.missionEnCours).toBe(true);
      expect(trouve).not.toHaveProperty("demandeTalentCreee");
    });
  });
});
