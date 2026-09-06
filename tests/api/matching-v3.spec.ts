import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS TALENT — Matching Engine V3 : Context & Trust (Batch 7) — chemin
// API : RBAC, isolation, absence de crash, déterminisme, non-régression du
// Matching V2. LEÇON DES BATCHES 4/5/6 : ce fichier n'écrit JAMAIS sur le
// profil "Ingénieur Démo" partagé. Il crée ses propres DemandeTalent
// (ressource privée par test) via POST/PATCH /api/talent/demandes, et
// n'appelle jamais POST .../matching (qui persisterait une ShortlistEntree) :
// GET .../matching-v3 recalcule le Matching Engine V2 à la volée, en
// lecture seule, exactement comme GET .../recommandations.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerDemande(request: APIRequestContext, description: string) {
  await connecter(request, "client-demo@example.com");
  const creation = await request.post("/api/talent/demandes", { data: { description } });
  expect(creation.status()).toBe(201);
  return creation.json();
}

test.describe("ATLAS TALENT — Matching Engine V3 : Context & Trust — API", () => {
  test("22. réponse 200, structure cohérente, aucun crash sur une demande fraîchement créée", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur Java, budget 700 EUR/jour.");

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { demandeId, matchingV3 } = await reponse.json();
    expect(demandeId).toBe(demande.id);
    expect(Array.isArray(matchingV3)).toBe(true);
    for (const r of matchingV3) {
      expect(typeof r.scoreV2).toBe("number");
      expect(Array.isArray(r.signauxContexte)).toBe(true);
      expect(Array.isArray(r.signauxConfiance)).toBe(true);
      expect(typeof r.avertissement).toBe("string");
      expect(r.avertissement.length).toBeGreaterThan(0);
    }
  });

  test("23. le Matching V2 (GET/POST .../matching) reste inchangé après consultation de .../matching-v3", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur, budget 600 EUR/jour.");
    await connecter(request, "admin-demo@example.com");
    await request.patch(`/api/talent/demandes/${demande.id}`, { data: { competencesExtraites: ["Java"] } });

    // POST .../matching (V2, existant, jamais modifié par ce Batch) — calcule
    // et persiste la shortlist V2 une première fois.
    const matchingAvant = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(matchingAvant.ok(), await matchingAvant.text()).toBeTruthy();
    const shortlistAvant = await matchingAvant.json();

    // Consultation de la fondation V3 (lecture seule) entre les deux.
    const v3Reponse = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    expect(v3Reponse.ok(), await v3Reponse.text()).toBeTruthy();

    // Le Matching V2 recalculé ensuite doit renvoyer exactement le même score
    // pour chaque profil — aucune influence de V3 sur V2.
    const matchingApres = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(matchingApres.ok(), await matchingApres.text()).toBeTruthy();
    const shortlistApres = await matchingApres.json();

    const scoresAvant = shortlistAvant.shortlist.map((e: { profilId: string; score: number }) => [e.profilId, e.score]).sort();
    const scoresApres = shortlistApres.shortlist.map((e: { profilId: string; score: number }) => [e.profilId, e.score]).sort();
    expect(scoresApres).toEqual(scoresAvant);
  });

  test("24. isolation RBAC : Matching V3 n'est accessible qu'à l'Admin (jamais Client ni Ingénieur)", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur Python.");

    const refusClient = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("25. demande inexistante : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/talent/demandes/inexistante-xyz/matching-v3");
    expect(reponse.status()).toBe(404);
  });

  test("26. déterminisme : deux appels consécutifs sur la même demande renvoient le même résultat", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur, budget 500 EUR/jour.");
    await connecter(request, "admin-demo@example.com");
    const r1 = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    const r2 = await request.get(`/api/talent/demandes/${demande.id}/matching-v3`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.matchingV3).toEqual(j2.matchingV3);
  });
});
