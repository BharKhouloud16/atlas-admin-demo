import { test, expect } from "@playwright/test";

// ATLAS TALENT V1 — révision des critères de matching par l'Admin avant
// de lancer le Matching Engine (voir PATCH /api/talent/demandes/[id]).
// Complète tests/api/talent-fondations.spec.ts (RBAC + chemin heureux de
// base) sans le dupliquer.

async function connecter(request: import("@playwright/test").APIRequestContext, email: string) {
  const reponse = await request.post("/api/auth/login", { data: { email, password: "Demo1234" } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("ATLAS TALENT — critères de matching (révision Admin)", () => {
  test("l'Admin peut vérifier/modifier les critères, le Client ne peut pas, et le matching relit bien les valeurs enregistrées", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/talent/demandes", {
      data: { description: "Recherche un développeur, compétence Docker, budget 400 EUR/jour." },
    });
    expect(creation.status()).toBe(201);
    const demande = await creation.json();

    // Le Client ne peut jamais modifier les critères internes de matching
    // (réservé Admin — même principe d'isolation que le reste du module).
    const refusClient = await request.patch(`/api/talent/demandes/${demande.id}`, {
      data: { competencesExtraites: ["Rust"] },
    });
    expect(refusClient.status()).toBe(403);

    await connecter(request, "admin-demo@example.com");

    // Validation stricte : une valeur hors bornes est rejetée (400), pas
    // silencieusement tronquée.
    const invalide = await request.patch(`/api/talent/demandes/${demande.id}`, {
      data: { anneesExperienceMin: -1 },
    });
    expect(invalide.status()).toBe(400);

    const revision = await request.patch(`/api/talent/demandes/${demande.id}`, {
      data: {
        competencesExtraites: ["Kubernetes", "Terraform"],
        senioriteSouhaitee: "Expert",
        anneesExperienceMin: 8,
        secteurActivite: "Assurance",
        localisation: "Lyon",
        mobilite: "Hybride",
        disponibiliteSouhaitee: "Sous 1 mois",
        budgetTjmMax: 750,
      },
    });
    expect(revision.status()).toBe(200);
    const demandeRevisee = await revision.json();
    expect(demandeRevisee.competencesExtraites).toEqual(["Kubernetes", "Terraform"]);
    expect(demandeRevisee.senioriteSouhaitee).toBe("Expert");
    expect(demandeRevisee.anneesExperienceMin).toBe(8);
    expect(demandeRevisee.secteurActivite).toBe("Assurance");
    expect(demandeRevisee.localisation).toBe("Lyon");
    expect(demandeRevisee.mobilite).toBe("Hybride");
    expect(demandeRevisee.disponibiliteSouhaitee).toBe("Sous 1 mois");
    expect(demandeRevisee.budgetTjmMax).toBe(750);
    // Traçabilité : qui a modifié, quand (voir aussi JournalActivite).
    expect(demandeRevisee.criteresModifiesParEmail).toBe("admin-demo@example.com");
    expect(demandeRevisee.criteresModifiesLe).toBeTruthy();

    // Le bouton "Lancer le matching" doit utiliser CES critères : le
    // Matching Engine relit la DemandeTalent en base (voir
    // app/api/talent/demandes/[id]/matching/route.ts), donc les valeurs
    // révisées doivent toujours être là juste avant le calcul.
    const matching = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(matching.status()).toBe(200);

    const liste = await request.get("/api/talent/demandes");
    const relue = (await liste.json()).find((d: { id: string }) => d.id === demande.id);
    expect(relue.competencesExtraites).toEqual(["Kubernetes", "Terraform"]);
    expect(relue.senioriteSouhaitee).toBe("Expert");
  });

  test("le Matching Engine V2 (score/motifs/TJM interne) n'est jamais exposé au Client", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/talent/demandes", {
      data: { description: "Recherche un développeur Kubernetes." },
    });
    expect(creation.status()).toBe(201);
    const demande = await creation.json();

    // Le Client ne peut ni déclencher ni relire le matching (réservé Admin —
    // voir app/api/talent/demandes/[id]/matching/route.ts).
    const postMatching = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(postMatching.status()).toBe(403);
    const getMatching = await request.get(`/api/talent/demandes/${demande.id}/matching`);
    expect(getMatching.status()).toBe(403);

    // La liste des demandes vue par le Client ne contient jamais les scores,
    // motifs ou TJM interne calculés par le Matching Engine.
    const liste = await request.get("/api/talent/demandes");
    const texte = await liste.text();
    expect(texte).not.toContain("shortlist");
    expect(texte).not.toContain("motifs");
    expect(texte).not.toContain("tjmEstime");
  });
});
