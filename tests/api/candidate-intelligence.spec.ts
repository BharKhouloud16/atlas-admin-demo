import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS TALENT — Candidate Intelligence V1 (Batch 4) — chemin API : isolation
// RBAC (Admin uniquement, jamais Client/Ingénieur), absence de crash sans
// Skill Graph, déterminisme. Complète tests/unit/candidate-intelligence.spec.ts
// (fonctions pures).

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

test.describe("ATLAS TALENT — Candidate Intelligence V1 — API", () => {
  test("14. candidat sans Skill Graph calculé : réponse 200, aucun crash, structure cohérente", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const profilVide = profils.find((p: { nom: string }) => p.nom === "Nouvel Ingénieur (test)");
    expect(profilVide).toBeTruthy();

    const reponse = await request.get(`/api/profils/${profilVide.id}/intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { intelligence } = await reponse.json();
    expect(intelligence.competences.principales).toEqual([]);
    expect(Array.isArray(intelligence.zonesInconnues)).toBe(true);
  });

  test("15. candidat avec Skill Graph : compétences reprises depuis le Skill Graph déjà calculé", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await request.post("/api/ingenieur/disponibilite", {
      data: {
        disponibilite: "Disponible immédiatement",
        preavis: "Aucun / immédiat",
        nationalite: "Française",
        paysResidence: "France",
        tjmSouhaite: 500,
        tjmSouhaiteDevise: "EUR",
        competences: ["Docker"],
      },
    });

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    await request.post(`/api/profils/${profilId}/competences`);

    const reponse = await request.get(`/api/profils/${profilId}/intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { intelligence } = await reponse.json();
    expect(intelligence.competences.principales.some((c: { competence: string }) => c.competence === "Docker")).toBe(true);
  });

  test("16. isolation RBAC : Candidate Intelligence n'est accessible qu'à l'Admin (jamais Client/Ingénieur)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get(`/api/profils/${profilId}/intelligence`);
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/intelligence`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("17. profil inexistant : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/profils/inexistant-xyz/intelligence");
    expect(reponse.status()).toBe(404);
  });

  test("18. déterminisme : deux appels consécutifs sur le même profil renvoient le même résultat", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/intelligence`);
    const r2 = await request.get(`/api/profils/${profilId}/intelligence`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.intelligence).toEqual(j2.intelligence);
  });
});
