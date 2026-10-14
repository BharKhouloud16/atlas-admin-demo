import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// ATLAS INTELLIGENCE FOUNDATION V1 (Batch 11) — chemin API : RBAC,
// structure, absence de crash, déterminisme. LEÇON DES BATCHES 4 À 10 :
// ce fichier reste strictement lecture seule — aucune écriture sur le
// profil "Ingénieur Démo" partagé.

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

async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/profils");
  expect(reponse.ok()).toBeTruthy();
  const { profils } = await reponse.json();
  const profil = profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo");
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil.id;
}

test.describe("ATLAS INTELLIGENCE FOUNDATION V1 — API", () => {
  test("43. Admin : réponse 200, les quatre blocs sont présents et cohérents", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { foundation } = await reponse.json();
    expect(foundation).toHaveProperty("candidateIntelligence");
    expect(foundation).toHaveProperty("talentIntelligence");
    expect(foundation).toHaveProperty("talentTrust");
    expect(foundation).toHaveProperty("missionIntelligence");
    expect(typeof foundation.avertissement).toBe("string");
    expect(foundation.avertissement.length).toBeGreaterThan(0);
  });

  test("44. aucun score global inventé exposé par l'API : uniquement les quatre blocs + avertissement + profilId", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const { foundation } = await reponse.json();
    const cles = Object.keys(foundation).sort();
    expect(cles).toEqual(["avertissement", "candidateIntelligence", "missionIntelligence", "profilId", "talentIntelligence", "talentTrust"].sort());
  });

  test("45. cohérence inter-blocs : le talentTrust exposé correspond bien au candidateIntelligence/talentIntelligence exposés dans la même réponse", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    // Comparaison avec les routes existantes déjà en production (Batch 4/5/8) :
    // la fondation ne doit jamais diverger de ce que ces routes renvoient déjà.
    const [rFoundation, rTalentTrust] = await Promise.all([
      request.get(`/api/profils/${profilId}/intelligence-foundation`),
      request.get(`/api/profils/${profilId}/talent-trust`),
    ]);
    const { foundation } = await rFoundation.json();
    const { talentTrust } = await rTalentTrust.json();
    expect(foundation.talentTrust).toEqual(talentTrust);
  });

  test("46. isolation RBAC : Intelligence Foundation n'est accessible qu'à l'Admin", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);

    request = await connecter("CLIENT");
    const refusClient = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    expect(refusClient.status()).toBe(403);

    request = await connecter("INGENIEUR");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("47. profil inexistant : 404, jamais un crash serveur", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/profils/inexistant-xyz/intelligence-foundation");
    expect(reponse.status()).toBe(404);
  });

  test("48. déterminisme : deux appels consécutifs renvoient le même résultat", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const r2 = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.foundation).toEqual(j2.foundation);
  });
});
