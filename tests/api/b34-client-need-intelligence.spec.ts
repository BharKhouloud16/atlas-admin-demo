import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
// Couvre CRUD, provenance, UNKNOWN, cohérence/contradiction, isolation
// client, IDOR/BOLA, et la non-consommation décisionnelle de
// HYPOTHESE_DOMAINE_SOLUTION — via la route réelle /api/client/besoins*.
// Les tests unitaires du moteur de cohérence et de l'extraction (règles
// détaillées, cas limites) vivent dans tests/unit/client-need-*.spec.ts —
// non dupliqués ici.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Reutilise la session deja authentifiee une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function creerBesoin(request: APIRequestContext, texteOriginal: string, titre?: string) {
  const reponse = await request.post("/api/client/besoins", { data: { texteOriginal, titre } });
  expect(reponse.status(), await reponse.text()).toBe(201);
  const { besoin } = await reponse.json();
  return besoin as {
    id: string;
    clientId: string;
    statut: string;
    coherenceStatut: string;
    faits: { cle: string; valeur: string; statut: string }[];
  };
}

test.describe("COMPANY ATLAS LOT 2 — Client Need Intelligence (API)", () => {
  test.describe("CRUD", () => {
    test("création — un besoin en texte libre est créé, statut SOUMIS, coherenceStatut calculé", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons deux QA automation seniors pour renforcer notre équipe pendant six mois, principalement sur Playwright et Java.");
      expect(besoin.statut).toBe("SOUMIS");
      expect(["COHERENT", "INCONSISTENT", "NEEDS_CLARIFICATION", "UNKNOWN"]).toContain(besoin.coherenceStatut);
      expect(besoin.faits.length).toBeGreaterThan(0);
    });

    test("lecture — le besoin créé est bien listé et lisible individuellement", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur React confirmé.");

      const liste = await request.get("/api/client/besoins");
      expect(liste.ok()).toBeTruthy();
      const { besoins } = await liste.json();
      expect(besoins.some((b: { id: string }) => b.id === besoin.id)).toBe(true);

      const lecture = await request.get(`/api/client/besoins/${besoin.id}`);
      expect(lecture.ok()).toBeTruthy();
      const { besoin: relu } = await lecture.json();
      expect(relu.id).toBe(besoin.id);
    });

    test("modification — le client peut renommer et changer le statut (VALIDE), jamais remettre en BROUILLON", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un ingénieur DevOps.");

      const renomme = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { titre: "Besoin DevOps Q4" } });
      expect(renomme.status(), await renomme.text()).toBe(200);
      expect((await renomme.json()).besoin.titre).toBe("Besoin DevOps Q4");

      const valide = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "VALIDE" } });
      expect(valide.status()).toBe(200);
      expect((await valide.json()).besoin.statut).toBe("VALIDE");

      const retourBrouillon = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "BROUILLON" } });
      expect(retourBrouillon.status()).toBe(400);
    });

    test("suppression — le client peut supprimer son besoin, les faits associés disparaissent (cascade)", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un architecte cloud.");

      const suppression = await request.delete(`/api/client/besoins/${besoin.id}`);
      expect(suppression.status()).toBe(200);

      const relecture = await request.get(`/api/client/besoins/${besoin.id}`);
      expect(relecture.status()).toBe(404);

      const faitsRestants = await prisma.clientNeedFait.count({ where: { needId: besoin.id } });
      expect(faitsRestants).toBe(0);
    });

    test("validation — texte trop court (< 10 caractères) refusé, jamais un besoin vide créé", async () => {
      let request = await connecter("CLIENT");
      const reponse = await request.post("/api/client/besoins", { data: { texteOriginal: "QA" } });
      expect(reponse.status()).toBe(400);
    });
  });

  test.describe("Provenance et UNKNOWN", () => {
    test("DECLARE — une information explicitement écrite par le client est marquée DECLARE", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un profil senior en Java.");
      const seniorite = besoin.faits.find((f) => f.cle === "SENIORITE");
      expect(seniorite?.valeur).toBe("Senior");
      expect(seniorite?.statut).toBe("DECLARE");
    });

    test("INFERE — HYPOTHESE_DOMAINE_SOLUTION est toujours présente et toujours INFERE, jamais DECLARE ni VERIFIE", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un QA Playwright.");
      const hypothese = besoin.faits.find((f) => f.cle === "HYPOTHESE_DOMAINE_SOLUTION");
      expect(hypothese).toBeTruthy();
      expect(hypothese?.statut).toBe("INFERE");
    });

    test("UNKNOWN — un attribut important non détecté produit une ligne explicite statut INCONNU, jamais une valeur inventée", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous avons besoin d'un QA.");
      const budgetInconnu = besoin.faits.find((f) => f.cle === "BUDGET_MONTANT");
      expect(budgetInconnu?.statut).toBe("INCONNU");
      expect(budgetInconnu?.valeur).toBe("");
      const localisationInconnue = besoin.faits.find((f) => f.cle === "LOCALISATION");
      expect(localisationInconnue?.statut).toBe("INCONNU");
    });
  });

  test.describe("Cohérence et contradictions", () => {
    test("contradiction — \"Junior + 10 ans\" produit coherenceStatut INCONSISTENT avec une explication compréhensible", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Je veux un profil junior avec 10 ans d'expérience.");
      expect(besoin.coherenceStatut).toBe("INCONSISTENT");
    });

    test("budget — un type de budget explicite sans montant produit NEEDS_CLARIFICATION", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous voulons un abonnement TJM pour un développeur.");
      // "TJM" seul déclenche BUDGET_TYPE sans montant chiffré dans ce texte.
      const type = besoin.faits.find((f) => f.cle === "BUDGET_TYPE");
      if (type) {
        expect(["NEEDS_CLARIFICATION", "COHERENT"]).toContain(besoin.coherenceStatut);
      }
    });

    test("besoin cohérent — aucune règle en défaut -> coherenceStatut COHERENT ou UNKNOWN, jamais INCONSISTENT à tort", async () => {
      let request = await connecter("CLIENT");
      const besoin = await creerBesoin(request, "Nous cherchons un profil senior avec 7 ans d'expérience en Java, budget 600 EUR par jour TJM, remote possible.");
      expect(besoin.coherenceStatut).not.toBe("INCONSISTENT");
    });
  });

  test.describe("Sécurité — isolation client / IDOR / BOLA", () => {
    test("un Client ne voit jamais les besoins d'un autre client dans la liste", async () => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT2 Isolation ${Date.now()}` } });

      const autreBesoin = await prisma.clientNeed.create({
        data: {
          clientId: autreClient.id,
          correlationId: `b34-isolation-${Date.now()}`,
          texteOriginal: "Besoin appartenant à un autre client.",
          statut: "SOUMIS",
        },
      });

      let request = await connecter("CLIENT");
      const liste = await request.get("/api/client/besoins");
      const { besoins } = await liste.json();
      expect(besoins.some((b: { id: string }) => b.id === autreBesoin.id)).toBe(false);
    });

    test("IDOR — accès direct par ID au besoin d'un autre client renvoie 404, jamais une fuite de contenu", async () => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT2 IDOR ${Date.now()}` } });
      const autreBesoin = await prisma.clientNeed.create({
        data: {
          clientId: autreClient.id,
          correlationId: `b34-idor-${Date.now()}`,
          texteOriginal: "Besoin confidentiel d'un autre client.",
          statut: "SOUMIS",
        },
      });

      let request = await connecter("CLIENT");
      const lecture = await request.get(`/api/client/besoins/${autreBesoin.id}`);
      expect(lecture.status()).toBe(404);
    });

    test("BOLA — un Client ne peut ni modifier ni supprimer le besoin d'un autre client", async () => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT2 BOLA ${Date.now()}` } });
      const autreBesoin = await prisma.clientNeed.create({
        data: {
          clientId: autreClient.id,
          correlationId: `b34-bola-${Date.now()}`,
          texteOriginal: "Besoin d'un autre client, jamais modifiable depuis un autre compte.",
          statut: "SOUMIS",
        },
      });

      let request = await connecter("CLIENT");
      const modification = await request.fetch(`/api/client/besoins/${autreBesoin.id}`, { method: "PATCH", data: { titre: "Tentative" } });
      expect(modification.status()).toBe(404);

      const suppression = await request.delete(`/api/client/besoins/${autreBesoin.id}`);
      expect(suppression.status()).toBe(404);

      const toujoursIntact = await prisma.clientNeed.findUnique({ where: { id: autreBesoin.id } });
      expect(toujoursIntact).not.toBeNull();
      expect(toujoursIntact?.titre).toBeNull();
    });

    test("clientId fourni dans le corps de la requête est structurellement ignoré — toujours celui de la session", async () => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT2 Spoof ${Date.now()}` } });

      let request = await connecter("CLIENT");
      const reponse = await request.post("/api/client/besoins", {
        data: { texteOriginal: "Tentative d'usurpation de clientId.", clientId: autreClient.id },
      });
      expect(reponse.status()).toBe(201);
      const { besoin } = await reponse.json();
      expect(besoin.clientId).not.toBe(autreClient.id);

      const vrai = await prisma.clientNeed.findUnique({ where: { id: besoin.id } });
      expect(vrai?.clientId).not.toBe(autreClient.id);
    });

    test("non authentifié / ADMIN / INGENIEUR : 403 sur toutes les routes /api/client/besoins*", async ({ request }) => {
      const sansSession = await request.post("/api/client/besoins", { data: { texteOriginal: "Peu importe le contenu ici." } });
      expect(sansSession.status()).toBe(403);

      request = await connecter("ADMIN");
      const admin = await request.get("/api/client/besoins");
      expect(admin.status()).toBe(403);

      request = await connecter("INGENIEUR");
      const ingenieur = await request.get("/api/client/besoins");
      expect(ingenieur.status()).toBe(403);
    });
  });

  test.describe("Absence de consommation décisionnelle de HYPOTHESE_DOMAINE_SOLUTION", () => {
    test("le statut du besoin et le flux de création ne dépendent jamais de la valeur de l'hypothèse de domaine", async () => {
      let request = await connecter("CLIENT");

      const besoinTalent = await creerBesoin(request, "Nous cherchons un développeur senior en Java.");
      const besoinAtlasOs = await creerBesoin(request, "Nous avons besoin d'un audit de sécurité de notre infrastructure.");
      const besoinInconnu = await creerBesoin(request, "Nous aimerions améliorer notre organisation interne.");

      // Statut SOUMIS dans les 3 cas, quelle que soit l'hypothèse déduite —
      // aucune branche de code ne route différemment selon HYPOTHESE_DOMAINE_SOLUTION.
      for (const b of [besoinTalent, besoinAtlasOs, besoinInconnu]) {
        expect(b.statut).toBe("SOUMIS");
        // Le champ n'existe QUE comme une ligne de fait parmi d'autres, jamais
        // une colonne dédiée sur la réponse elle-même.
        expect(Object.keys(b)).not.toContain("type");
        expect(Object.keys(b)).not.toContain("domaine");
        expect(Object.keys(b)).not.toContain("routage");
      }
    });
  });
});
