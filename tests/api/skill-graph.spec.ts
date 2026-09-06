import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS SKILL GRAPH V1 — chemin API complet : association compétence/profil,
// isolation CLIENT/ADMIN/INGENIEUR, et non-régression d'une correction Admin
// (VERIFIE) lors d'un recalcul. Complète tests/unit/skill-graph.spec.ts (les
// fonctions pures de lib/talent/skill-graph.ts).

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

// Déclare "Playwright" comme compétence de l'Ingénieur Démo via le
// questionnaire de disponibilité (seule route existante qui écrit
// Profil.competences) — préalable réel, pas une donnée injectée directement
// en base : le Skill Graph doit pouvoir la lire ensuite comme n'importe
// quelle compétence déclarée par un vrai ingénieur.
async function declarerCompetence(request: APIRequestContext, competences: string[]) {
  const reponse = await request.post("/api/ingenieur/disponibilite", {
    data: {
      disponibilite: "Disponible immédiatement",
      preavis: "Aucun / immédiat",
      nationalite: "Française",
      paysResidence: "France",
      tjmSouhaite: 500,
      tjmSouhaiteDevise: "EUR",
      competences,
    },
  });
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
}

test.describe("ATLAS SKILL GRAPH V1 — API", () => {
  test("2/5. association compétence/profil : une compétence déclarée par l'ingénieur devient une ProfilCompetence DECLARE avec preuve PROFIL", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Playwright"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    const construction = await request.post(`/api/profils/${profilId}/competences`);
    expect(construction.ok(), await construction.text()).toBeTruthy();
    const { competences } = await construction.json();

    const playwright = competences.find((c: { competence: string }) => c.competence === "Playwright");
    expect(playwright, "Playwright devrait apparaître dans le Skill Graph").toBeTruthy();
    expect(playwright.statut).toBe("DECLARE");
    expect(playwright.niveau).toBeNull(); // jamais un niveau fabriqué
    expect(playwright.preuves.some((p: { source: string }) => p.source === "PROFIL")).toBe(true);
  });

  test("6. compétence vérifiée : une correction Admin (VERIFIE) n'est jamais écrasée par un recalcul automatique ultérieur", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Playwright", "Docker"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    const premiereConstruction = await request.post(`/api/profils/${profilId}/competences`);
    expect(premiereConstruction.ok()).toBeTruthy();
    const { competences: avant } = await premiereConstruction.json();
    const docker = avant.find((c: { competence: string; id: string }) => c.competence === "Docker");
    expect(docker).toBeTruthy();

    const correction = await request.patch(`/api/profils/${profilId}/competences/${docker.id}`, {
      data: { statut: "VERIFIE", niveau: 4, detail: "Confirmé en entretien technique" },
    });
    expect(correction.ok(), await correction.text()).toBeTruthy();
    const verifie = await correction.json();
    expect(verifie.statut).toBe("VERIFIE");
    expect(verifie.niveau).toBe(4);
    expect(verifie.confiance).toBe("HAUTE");

    // Un recalcul automatique (ré-analyse) ne doit jamais rétrograder cette
    // compétence désormais VERIFIE, ni effacer le niveau fixé par l'Admin.
    const secondeConstruction = await request.post(`/api/profils/${profilId}/competences`);
    expect(secondeConstruction.ok()).toBeTruthy();
    const { competences: apres } = await secondeConstruction.json();
    const dockerApres = apres.find((c: { competence: string }) => c.competence === "Docker");
    expect(dockerApres.statut).toBe("VERIFIE");
    expect(dockerApres.niveau).toBe(4);
  });

  test("10. isolation CLIENT/INGENIEUR : le Skill Graph n'est accessible qu'à l'Admin", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);

    await connecter(request, "client-demo@example.com");
    const getClient = await request.get(`/api/profils/${profilId}/competences`);
    expect(getClient.status()).toBe(403);
    const postClient = await request.post(`/api/profils/${profilId}/competences`);
    expect(postClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const getIngenieur = await request.get(`/api/profils/${profilId}/competences`);
    expect(getIngenieur.status()).toBe(403);
  });

  test("8/9. données manquantes : un profil sans aucune source réelle ne génère aucune compétence fictive", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    // "Nouvel Ingénieur (test)" (voir prisma/seed.ts) : profil en attente,
    // sans compétences déclarées ni InfoCV validée.
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const profilVide = profils.find((p: { nom: string }) => p.nom === "Nouvel Ingénieur (test)");
    expect(profilVide).toBeTruthy();

    const construction = await request.post(`/api/profils/${profilVide.id}/competences`);
    expect(construction.ok()).toBeTruthy();
    const { competences, creees } = await construction.json();
    expect(competences).toEqual([]);
    expect(creees).toBe(0);
  });
});
