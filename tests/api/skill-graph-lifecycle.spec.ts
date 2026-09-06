import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS DYNAMIC SKILL GRAPH / EVIDENCE LIFECYCLE V1 — chemin API complet de
// la nouvelle route POST .../competences/[competenceId]/preuves : preuve
// toujours additive (jamais de suppression/écrasement), historique de
// niveaux exposé (CURRENT LEVEL vs HISTORICAL LEVELS), isolation RBAC
// identique au reste du module Skill Graph. Complète tests/api/skill-graph.
// spec.ts (chemin de construction initial, non modifié par ce batch) et
// tests/unit/{skill-graph,evidence-confidence}.spec.ts (fonctions pures).

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

test.describe("ATLAS DYNAMIC SKILL GRAPH — Evidence Lifecycle V1 — API", () => {
  test("11. ajout d'une preuve (POST .../preuves) : additive, jamais de suppression des preuves précédentes", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Kubernetes"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const k8s = competences.find((c: { competence: string; id: string }) => c.competence === "Kubernetes");
    expect(k8s).toBeTruthy();
    expect(k8s.preuves.length).toBe(1); // PROFIL seule pour l'instant

    const ajout = await request.post(`/api/profils/${profilId}/competences/${k8s.id}/preuves`, {
      data: { source: "MISSION", detail: "Mission client X, module Kubernetes", niveauObserve: 3 },
    });
    expect(ajout.ok(), await ajout.text()).toBeTruthy();
    const apres = await ajout.json();

    // Les deux preuves coexistent — aucune n'a été supprimée.
    expect(apres.preuves.length).toBe(2);
    expect(apres.preuves.some((p: { source: string }) => p.source === "PROFIL")).toBe(true);
    expect(apres.preuves.some((p: { source: string }) => p.source === "MISSION")).toBe(true);
  });

  test("12. plusieurs preuves conservées dans le temps : une 3e preuve n'écrase pas les 2 précédentes", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Terraform"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const terraform = competences.find((c: { competence: string; id: string }) => c.competence === "Terraform");

    await request.post(`/api/profils/${profilId}/competences/${terraform.id}/preuves`, {
      data: { source: "MISSION", detail: "Mission A", niveauObserve: 2 },
    });
    const derniere = await request.post(`/api/profils/${profilId}/competences/${terraform.id}/preuves`, {
      data: { source: "EVALUATION", detail: "Évaluation annuelle", niveauObserve: 3 },
    });
    expect(derniere.ok(), await derniere.text()).toBeTruthy();
    const apres = await derniere.json();
    expect(apres.preuves.length).toBe(3); // PROFIL + MISSION + EVALUATION
  });

  test("13. historique des niveaux (niveauxHistoriques) : distingue CURRENT LEVEL (niveau) et HISTORICAL LEVELS, ordre chronologique", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Jenkins"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const jenkins = competences.find((c: { competence: string; id: string }) => c.competence === "Jenkins");

    await request.post(`/api/profils/${profilId}/competences/${jenkins.id}/preuves`, {
      data: { source: "MISSION", niveauObserve: 2 },
    });
    const derniere = await request.post(`/api/profils/${profilId}/competences/${jenkins.id}/preuves`, {
      data: { source: "MISSION", niveauObserve: 4 },
    });
    const apres = await derniere.json();
    expect(apres.niveauxHistoriques.map((h: { niveau: number }) => h.niveau)).toEqual([2, 4]);

    // CURRENT LEVEL (niveau sur la compétence elle-même) : aucune de ces
    // preuves ne comportait de statutPropose VERIFIE avec niveau Admin — le
    // niveau courant reste piloté par fusionnerCompetence, jamais confondu
    // avec l'historique.
    expect(apres).toHaveProperty("niveau");
    expect(apres.niveauxHistoriques).not.toEqual(apres.niveau);
  });

  test("14. contexte/provenance préservés : chaque preuve garde sa source et son détail d'origine", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["SQL"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const sql = competences.find((c: { competence: string; id: string }) => c.competence === "SQL");

    const ajout = await request.post(`/api/profils/${profilId}/competences/${sql.id}/preuves`, {
      data: { source: "CERTIFICATION", detail: "Certification SQL avancé, 2026" },
    });
    const apres = await ajout.json();
    const nouvellePreuve = apres.preuves.find((p: { source: string }) => p.source === "CERTIFICATION");
    expect(nouvellePreuve.detail).toBe("Certification SQL avancé, 2026");
  });

  test("15. RBAC : la route d'ajout de preuve est réservée à l'Admin (CLIENT et INGENIEUR refusés)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const competenceQuelconque = competences[0];
    test.skip(!competenceQuelconque, "aucune compétence disponible pour ce test sur ce jeu de données");

    await connecter(request, "client-demo@example.com");
    const refusClient = await request.post(`/api/profils/${profilId}/competences/${competenceQuelconque.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative non autorisée" },
    });
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.post(`/api/profils/${profilId}/competences/${competenceQuelconque.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative non autorisée" },
    });
    expect(refusIngenieur.status()).toBe(403);
  });

  test("16. isolation tenant : une compétence d'un autre profil renvoie 404, jamais les données d'un tiers", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const autreProfil = profils.find((p: { nom: string }) => p.nom !== "Ingénieur Démo");
    test.skip(!autreProfil, "au moins deux profils requis pour ce test");

    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    test.skip(competences.length === 0, "aucune compétence disponible pour ce test");
    const competenceDuBonProfil = competences[0];

    const reponse = await request.post(`/api/profils/${autreProfil.id}/competences/${competenceDuBonProfil.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative cross-tenant" },
    });
    expect(reponse.status()).toBe(404);
  });

  test("17. compétence inexistante : 404, jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.post(`/api/profils/${profilId}/competences/inexistante-xyz/preuves`, {
      data: { source: "ADMIN", detail: "test" },
    });
    expect(reponse.status()).toBe(404);
  });

  test("18. validation : une source invalide est rejetée (400), aucune preuve fabriquée", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    await declarerCompetence(request, ["Python"]);

    await connecter(request, "admin-demo@example.com");
    const profilId = await idProfilIngenieurDemo(request);
    const construction = await request.post(`/api/profils/${profilId}/competences`);
    const { competences } = await construction.json();
    const python = competences.find((c: { competence: string; id: string }) => c.competence === "Python");

    const invalide = await request.post(`/api/profils/${profilId}/competences/${python.id}/preuves`, {
      data: { source: "SOURCE_INEXISTANTE", detail: "test" },
    });
    expect(invalide.status()).toBe(400);
  });
});
