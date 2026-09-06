import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS TALENT — Mission Intelligence V1 (Batch 9) — chemin API : RBAC,
// isolation, absence de crash, déterminisme. LEÇON DES BATCHES 4/5/6/7/8 :
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

test.describe("ATLAS TALENT — Mission Intelligence V1 — API", () => {
  test("32. candidat sans mission : réponse 200, aucun crash, statistiques INSUFFISANTE/null plutôt qu'inventées", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const profilVide = profils.find((p: { nom: string }) => p.nom === "Nouvel Ingénieur (test)");
    expect(profilVide).toBeTruthy();

    const reponse = await request.get(`/api/profils/${profilVide.id}/mission-intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { missionIntelligence } = await reponse.json();
    expect(missionIntelligence.activite.total).toBe(0);
    expect(missionIntelligence.activite.tauxReussite.valeur).toBeNull();
    expect(missionIntelligence.satisfaction.tendance).toBe("INCONNUE");
    expect(missionIntelligence.competencesUtilisees).toEqual([]);
  });

  test("33. structure cohérente sur un profil avec historique réel, jamais un crash", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.get(`/api/profils/${profilId}/mission-intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { missionIntelligence } = await reponse.json();
    expect(typeof missionIntelligence.activite.total).toBe("number");
    expect(["SUFFISANTE", "INSUFFISANTE"]).toContain(missionIntelligence.activite.tauxReussite.statut);
    expect(["HAUSSE", "BAISSE", "STABLE", "INCONNUE"]).toContain(missionIntelligence.satisfaction.tendance);
    expect(typeof missionIntelligence.avertissement).toBe("string");
    expect(missionIntelligence.avertissement.length).toBeGreaterThan(0);
  });

  test("34. isolation RBAC : Mission Intelligence n'est accessible qu'à l'Admin", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get(`/api/profils/${profilId}/mission-intelligence`);
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/mission-intelligence`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("35. profil inexistant : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/profils/inexistant-xyz/mission-intelligence");
    expect(reponse.status()).toBe(404);
  });

  test("36. déterminisme : deux appels consécutifs renvoient le même résultat", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/mission-intelligence`);
    const r2 = await request.get(`/api/profils/${profilId}/mission-intelligence`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.missionIntelligence).toEqual(j2.missionIntelligence);
  });
});
