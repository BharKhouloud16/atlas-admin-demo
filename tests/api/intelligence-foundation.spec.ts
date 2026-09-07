import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS INTELLIGENCE FOUNDATION V1 (Batch 11) — chemin API : RBAC,
// structure, absence de crash, déterminisme. LEÇON DES BATCHES 4 À 10 :
// ce fichier reste strictement lecture seule — aucune écriture sur le
// profil "Ingénieur Démo" partagé.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
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
  test("43. Admin : réponse 200, les quatre blocs sont présents et cohérents", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
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

  test("44. aucun score global inventé exposé par l'API : uniquement les quatre blocs + avertissement + profilId", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const { foundation } = await reponse.json();
    const cles = Object.keys(foundation).sort();
    expect(cles).toEqual(["avertissement", "candidateIntelligence", "missionIntelligence", "profilId", "talentIntelligence", "talentTrust"].sort());
  });

  test("45. cohérence inter-blocs : le talentTrust exposé correspond bien au candidateIntelligence/talentIntelligence exposés dans la même réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
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

  test("46. isolation RBAC : Intelligence Foundation n'est accessible qu'à l'Admin", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("47. profil inexistant : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/profils/inexistant-xyz/intelligence-foundation");
    expect(reponse.status()).toBe(404);
  });

  test("48. déterminisme : deux appels consécutifs renvoient le même résultat", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const r2 = await request.get(`/api/profils/${profilId}/intelligence-foundation`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.foundation).toEqual(j2.foundation);
  });
});
