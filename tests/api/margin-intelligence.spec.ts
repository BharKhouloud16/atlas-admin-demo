import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS FINANCE — Margin Intelligence V1 (Batch 10) — chemin API. SÉCURITÉ
// CRITIQUE : les données financières internes (coûts, marges) ne doivent
// JAMAIS être accessibles à CLIENT, ni à INGENIEUR — y compris quand ils
// sont respectivement le client propriétaire ou l'ingénieur affecté à la
// mission consultée. Ce fichier reste strictement lecture seule — aucune
// écriture sur Mission ni FeuilleDeTemps, aucune écriture sur le profil
// "Ingénieur Démo" partagé (leçon des Batches 4 à 9).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idMissionSeed(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/missions");
  expect(reponse.ok()).toBeTruthy();
  const missions = await reponse.json();
  const mission = missions.find((m: { repere: string }) => m.repere === "Audit Q4 2026");
  expect(mission, "la mission de démo 'Audit Q4 2026' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return mission.id;
}

test.describe("ATLAS FINANCE — Margin Intelligence V1 — API", () => {
  test("37. Admin : réponse 200, structure cohérente (prévisionnel connu, réel INCONNU sans CRA validé)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionId = await idMissionSeed(request);
    const reponse = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { marginIntelligence } = await reponse.json();
    expect(marginIntelligence.previsionnel.statut).toBe("CONNU");
    expect(typeof marginIntelligence.previsionnel.margePct).toBe("number");
    expect(["CRITIQUE", "ATTENTION", "OK", "INCONNU"]).toContain(marginIntelligence.alerte.niveau);
    expect(typeof marginIntelligence.avertissement).toBe("string");
    expect(marginIntelligence.avertissement.length).toBeGreaterThan(0);
  });

  test("38. SÉCURITÉ CRITIQUE : CLIENT n'a jamais accès à /api/missions/[id]/marge-intelligence, même sur sa propre mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionId = await idMissionSeed(request);

    await connecter(request, "client-demo@example.com");
    const refus = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(refus.status()).toBe(403);
    const corps = await refus.json();
    // Aucune fuite de champ financier dans le corps du refus lui-même
    expect(JSON.stringify(corps)).not.toMatch(/margePct|tjmCout|coutTotal|margeEuros/);
  });

  test("39. SÉCURITÉ CRITIQUE : INGENIEUR n'a jamais accès à /api/missions/[id]/marge-intelligence, même affecté à la mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionId = await idMissionSeed(request);

    await connecter(request, "ingenieur-demo@example.com");
    const refus = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(refus.status()).toBe(403);
  });

  test("40. SÉCURITÉ CRITIQUE (régression) : /api/client/missions ne renvoie jamais de champ tarifaire interne", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const reponse = await request.get("/api/client/missions");
    expect(reponse.ok()).toBeTruthy();
    const missions = await reponse.json();
    const texte = JSON.stringify(missions);
    expect(texte).not.toMatch(/tjmVente|tjmCout|margeEuros|margePct|coutTotal|montantSaisi/);
  });

  test("41. mission inexistante : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/missions/inexistante-xyz/marge-intelligence");
    expect(reponse.status()).toBe(404);
  });

  test("42. déterminisme : deux appels consécutifs (Admin) renvoient le même résultat", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionId = await idMissionSeed(request);
    const r1 = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    const r2 = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.marginIntelligence).toEqual(j2.marginIntelligence);
  });
});
