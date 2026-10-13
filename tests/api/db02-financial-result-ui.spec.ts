import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-02 : Financial Result UI (08/10/2026).
//
// Couvre les 15 scénarios obligatoires du mandat DB-02 §15. DB-02 ne
// modifie AUCUNE route/service A29 (app/api/missions/[id]/financial-
// results/**, lib/financial-result/financial-result.ts) — cette suite
// verrouille donc le contrat existant tel qu'il est réellement consommé
// par la nouvelle page app/admin/missions/[id]/financial-results/page.tsx,
// jamais une réimplémentation de a29-financial-result.spec.ts (déjà
// exhaustif sur le moteur lui-même, inchangé, non dupliqué ici).

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Réutilise la session déjà authentifiée une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test — élimine la contribution de ce fichier à
// l'épuisement du rate-limit de connexion partagé par IP en CI
// (lib/rate-limit.ts), sans changer le rôle/contexte testé.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function creerMission(statut: StatutMission = StatutMission.TERMINEE) {
  const client = await clientDemo();
  const profil = await prisma.profil.create({ data: { nom: `Profil Test DB02 ${Date.now()}-${Math.random()}` } });
  return prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, repere: `Mission Test DB02 ${Date.now()}-${Math.random()}`, nbJours: 10, tjmVente: 500, statut },
  });
}

test.describe("DB-02 — Consultation", () => {
  test("1. ADMIN consulte le FinancialResult d'une Mission autorisée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, {
      data: { revenueAmount: 10000, revenueProvenance: "DECLARE", revenueJustification: "Facture signée." },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.missionId).toBe(mission.id);
    expect(corps.financialResults).toHaveLength(1);
  });

  test("2. Mission sans FinancialResult -> liste vide, jamais une erreur", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).financialResults).toHaveLength(0);
  });

  test("3. Mission inexistante -> 404 (comportement backend existant, inchangé)", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/missions/inexistant-cuid/financial-results");
    expect(reponse.status()).toBe(404);
  });

  test("4. cross-tenant : FinancialResult d'une autre Mission -> 404, jamais une fuite d'existence", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const creation = await request.post(`/api/missions/${missionB.id}/financial-results`, { data: {} });
    const resultatB = await creation.json();

    const reponse = await request.get(`/api/missions/${missionA.id}/financial-results/${resultatB.id}`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("DB-02 — Données affichées", () => {
  test("5. valeurs financières renvoyées exactement telles que fournies (revenue/cost), jamais arrondies/altérées en plus de la précision serveur", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, {
      data: {
        revenueAmount: 12345.67,
        revenueProvenance: "VERIFIE",
        revenueJustification: "Facture #42 encaissée.",
        costAmount: 8000.5,
        costProvenance: "DECLARE",
        costJustification: "Coût interne estimé.",
      },
    });
    const corps = await creation.json();
    expect(Number(corps.revenueAmount)).toBe(12345.67);
    expect(Number(corps.costAmount)).toBe(8000.5);
    expect(Number(corps.profitAmount)).toBeCloseTo(4345.17, 2);
  });

  test("6. devise affichée correctement (fournie, ou héritée de Mission.deviseVente si absente)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const avecDevise = await request.post(`/api/missions/${mission.id}/financial-results`, { data: { currency: "USD" } });
    expect((await avecDevise.json()).currency).toBe("USD");

    const sansDevise = await request.post(`/api/missions/${mission.id}/financial-results`, { data: {} });
    const missionEnBase = await prisma.mission.findUnique({ where: { id: mission.id }, select: { deviseVente: true } });
    expect((await sansDevise.json()).currency).toBe(missionEnBase?.deviseVente);
  });

  test("7. dates affichées (calculatedAt, createdAt) renvoyées par le serveur", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const avant = Date.now();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, { data: {} });
    const corps = await creation.json();
    expect(new Date(corps.calculatedAt).getTime()).toBeGreaterThanOrEqual(avant - 1000);
    expect(new Date(corps.createdAt).getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("8. statut affiché correctement (DRAFT à la création, FINALIZED après finalisation)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, { data: {} });
    const resultat = await creation.json();
    expect(resultat.statut).toBe("DRAFT");

    const finalisation = await request.patch(`/api/missions/${mission.id}/financial-results/${resultat.id}`, { data: { action: "finaliser" } });
    expect((await finalisation.json()).statut).toBe("FINALIZED");
  });

  test("9. plusieurs FinancialResult indépendants correctement représentés (le modèle les autorise, contrat A29 §35)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    await request.post(`/api/missions/${mission.id}/financial-results`, { data: { revenueAmount: 1000, revenueProvenance: "DECLARE", revenueJustification: "A" } });
    await request.post(`/api/missions/${mission.id}/financial-results`, { data: { revenueAmount: 2000, revenueProvenance: "DECLARE", revenueJustification: "B" } });

    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect((await reponse.json()).financialResults).toHaveLength(2);
  });
});

test.describe("DB-02 — RBAC", () => {
  test("10. CLIENT ne reçoit aucune nouvelle capacité (403, même sur sa propre Mission)", async () => {
    const mission = await creerMission();
    let request = await connecter("CLIENT");
    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect(reponse.status()).toBe(403);
  });

  test("11. INGENIEUR ne reçoit aucune nouvelle permission (403, même sur sa propre Mission)", async () => {
    const mission = await creerMission();
    let request = await connecter("INGENIEUR");
    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect(reponse.status()).toBe(403);
  });

  test("12. utilisateur non authentifié -> rejet backend (403)", async ({ request }) => {
    const mission = await creerMission();
    const reponse = await request.get(`/api/missions/${mission.id}/financial-results`);
    expect(reponse.status()).toBe(403);
  });
});

test.describe("DB-02 — Mutations", () => {
  test("13. action officielle 'finaliser' fonctionne (API existante, inchangée)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, { data: {} });
    const resultat = await creation.json();

    const reponse = await request.patch(`/api/missions/${mission.id}/financial-results/${resultat.id}`, { data: { action: "finaliser" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("FINALIZED");
  });

  test("14. append-only : une correction crée une NOUVELLE ligne, jamais un écrasement de la ligne finalisée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const creation = await request.post(`/api/missions/${mission.id}/financial-results`, {
      data: { revenueAmount: 5000, revenueProvenance: "DECLARE", revenueJustification: "Initial." },
    });
    const original = await creation.json();
    await request.patch(`/api/missions/${mission.id}/financial-results/${original.id}`, { data: { action: "finaliser" } });

    const correction = await request.post(`/api/missions/${mission.id}/financial-results`, {
      data: { revenueAmount: 6000, revenueProvenance: "VERIFIE", revenueJustification: "Corrigé.", supersedesId: original.id },
    });
    expect(correction.status(), await correction.text()).toBe(201);
    const corrige = await correction.json();
    expect(corrige.supersedesId).toBe(original.id);

    const originalEnBase = await prisma.financialResult.findUnique({ where: { id: original.id } });
    expect(Number(originalEnBase?.revenueAmount)).toBe(5000);
    expect(originalEnBase?.statut).toBe("FINALIZED");
  });

  test("15. aucune mutation financière directe depuis le frontend : profit/margin/resultatGlobal fournis par le client sont ignorés, toujours recalculés serveur", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await request.post(`/api/missions/${mission.id}/financial-results`, {
      data: {
        revenueAmount: 1000,
        revenueProvenance: "DECLARE",
        revenueJustification: "Test",
        costAmount: 400,
        costProvenance: "DECLARE",
        costJustification: "Test",
        // Tentative d'injection de valeurs calculées côté client — doivent
        // être silencieusement ignorées, jamais acceptées comme vérité.
        profitAmount: 999999,
        marginPct: 0.99,
        resultatGlobal: "PROFIT",
      },
    });
    const corps = await reponse.json();
    expect(Number(corps.profitAmount)).toBe(600);
    expect(corps.resultatGlobal).toBe("PROFIT");
    expect(Number(corps.marginPct)).toBeCloseTo(0.6, 4);
  });
});
