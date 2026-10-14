import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// ATLAS FINANCE — Margin Intelligence V1 (Batch 10) — chemin API. SÉCURITÉ
// CRITIQUE : les données financières internes (coûts, marges) ne doivent
// JAMAIS être accessibles à CLIENT, ni à INGENIEUR — y compris quand ils
// sont respectivement le client propriétaire ou l'ingénieur affecté à la
// mission consultée. Ce fichier reste strictement lecture seule — aucune
// écriture sur Mission ni FeuilleDeTemps, aucune écriture sur le profil
// "Ingénieur Démo" partagé (leçon des Batches 4 à 9).

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

async function idMissionSeed(): Promise<string> {
  // LOT 16.3 — GET /api/missions est désormais paginé (page=1&pageSize=20
  // par défaut) : la mission de seed "Audit Q4 2026" n'est plus garantie
  // d'apparaître sur la première page vu le volume de missions accumulées
  // en base de test. Cette fonction n'a besoin que d'un identifiant de
  // fixture valide, jamais d'exercer le comportement de la liste paginée —
  // lookup direct en base, sans round-trip HTTP.
  const mission = await prisma.mission.findFirst({ where: { repere: "Audit Q4 2026" } });
  expect(mission, "la mission de démo 'Audit Q4 2026' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return mission!.id;
}

test.describe("ATLAS FINANCE — Margin Intelligence V1 — API", () => {
  test("37. Admin : réponse 200, structure cohérente (prévisionnel connu, réel INCONNU sans CRA validé)", async () => {
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();
    const reponse = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { marginIntelligence } = await reponse.json();
    expect(marginIntelligence.previsionnel.statut).toBe("CONNU");
    expect(typeof marginIntelligence.previsionnel.margePct).toBe("number");
    expect(["CRITIQUE", "ATTENTION", "OK", "INCONNU"]).toContain(marginIntelligence.alerte.niveau);
    expect(typeof marginIntelligence.avertissement).toBe("string");
    expect(marginIntelligence.avertissement.length).toBeGreaterThan(0);
  });

  test("38. SÉCURITÉ CRITIQUE : CLIENT n'a jamais accès à /api/missions/[id]/marge-intelligence, même sur sa propre mission", async () => {
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();

    request = await connecter("CLIENT");
    const refus = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(refus.status()).toBe(403);
    const corps = await refus.json();
    // Aucune fuite de champ financier dans le corps du refus lui-même
    expect(JSON.stringify(corps)).not.toMatch(/margePct|tjmCout|coutTotal|margeEuros/);
  });

  test("39. SÉCURITÉ CRITIQUE : INGENIEUR n'a jamais accès à /api/missions/[id]/marge-intelligence, même affecté à la mission", async () => {
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();

    request = await connecter("INGENIEUR");
    const refus = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(refus.status()).toBe(403);
  });

  test("40. SÉCURITÉ CRITIQUE (régression) : /api/client/missions ne renvoie jamais de champ tarifaire interne", async () => {
    let request = await connecter("CLIENT");
    const reponse = await request.get("/api/client/missions");
    expect(reponse.ok()).toBeTruthy();
    const missions = await reponse.json();
    const texte = JSON.stringify(missions);
    expect(texte).not.toMatch(/tjmVente|tjmCout|margeEuros|margePct|coutTotal|montantSaisi/);
  });

  test("41. mission inexistante : 404, jamais un crash serveur", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/missions/inexistante-xyz/marge-intelligence");
    expect(reponse.status()).toBe(404);
  });

  test("42. déterminisme : deux appels consécutifs (Admin) renvoient le même résultat", async () => {
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();
    const r1 = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    const r2 = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.marginIntelligence).toEqual(j2.marginIntelligence);
  });
});
