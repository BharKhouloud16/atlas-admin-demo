import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS TALENT — Talent Recommendation Engine V1 (Batch 6) — chemin API :
// RBAC, isolation, absence de crash, déterminisme, vocabulaire "revue
// humaine". LEÇON DES BATCHES 4/5 (voir tests/api/talent-intelligence.spec.ts) :
// ce fichier n'écrit JAMAIS sur le profil "Ingénieur Démo" partagé (aucun
// appel à /api/ingenieur/disponibilite). Il crée en revanche ses propres
// DemandeTalent (ressource privée à chaque test, jamais partagée entre
// fichiers) via POST/PATCH /api/talent/demandes — même pattern déjà établi
// par tests/api/talent-criteres.spec.ts — et n'appelle jamais POST
// .../matching (qui persisterait une ShortlistEntree) : GET .../recommandations
// recalcule le Matching Engine V2 à la volée, en lecture seule.

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

test.describe("ATLAS TALENT — Talent Recommendation Engine V1 — API", () => {
  test("16. réponse 200, structure cohérente, aucun crash sur une demande fraîchement créée", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur Java, budget 700 EUR/jour.");

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { demandeId, recommandations } = await reponse.json();
    expect(demandeId).toBe(demande.id);
    expect(Array.isArray(recommandations)).toBe(true);
    for (const r of recommandations) {
      expect(typeof r.recommandation).toBe("string");
      expect(r.recommandation.toLowerCase()).toContain("revue humaine");
      expect(Array.isArray(r.criteresManquants)).toBe(true);
      expect(Array.isArray(r.contradictions)).toBe(true);
      expect(Array.isArray(r.preuves)).toBe(true);
    }
  });

  test("17. jamais de décision automatique dans le texte produit, quel que soit le candidat", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur, compétence rarissime XYZ123, budget 50 EUR/jour.");

    await connecter(request, "admin-demo@example.com");
    // Critères volontairement impossibles à satisfaire (compétence inexistante,
    // budget dérisoire) pour forcer des statuts INCOMPATIBLE/INSUFFISANT.
    await request.patch(`/api/talent/demandes/${demande.id}`, {
      data: { competencesExtraites: ["XYZ123"], budgetTjmMax: 1 },
    });

    const reponse = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { recommandations } = await reponse.json();
    for (const r of recommandations) {
      expect(r.recommandation.toLowerCase()).not.toContain("sélectionné automatiquement");
      expect(r.recommandation.toLowerCase()).not.toContain("accepté automatiquement");
      expect(r.recommandation.toLowerCase()).not.toContain("rejeté automatiquement");
    }
  });

  test("18. isolation RBAC : les recommandations ne sont accessibles qu'à l'Admin (jamais Client ni Ingénieur)", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur Python.");

    // Le Client qui a créé la demande n'a pas non plus accès aux
    // recommandations internes (mêmes données sensibles que Matching V2).
    const refusClient = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("19. demande inexistante : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/talent/demandes/inexistante-xyz/recommandations");
    expect(reponse.status()).toBe(404);
  });

  test("20. déterminisme : deux appels consécutifs sur la même demande renvoient la même liste de recommandations", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur, budget 600 EUR/jour.");

    await connecter(request, "admin-demo@example.com");
    const r1 = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    const r2 = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.recommandations).toEqual(j2.recommandations);
  });

  test("21. aucune fuite de données internes vers un rôle non autorisé : la réponse 403 ne contient aucun champ de recommandation", async ({ request }) => {
    const demande = await creerDemande(request, "Recherche un développeur.");
    const refus = await request.get(`/api/talent/demandes/${demande.id}/recommandations`);
    expect(refus.status()).toBe(403);
    const corps = await refus.json();
    expect(corps.recommandations).toBeUndefined();
  });
});
