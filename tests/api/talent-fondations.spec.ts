import { test, expect } from "@playwright/test";

// ATLAS TALENT V1 — fondations (06/09). Couvre uniquement le RBAC et le
// chemin heureux minimal : le détail du Matching Engine est testé sans DB
// dans tests/unit/matching.spec.ts. Compte de démo unique par rôle (voir
// prisma/seed.ts) — pas de test d'isolation cross-client ici (même limite
// que le reste de la suite existante), déjà couvert dans son principe par
// tests/api/permissions.spec.ts pour /api/client/missions.

async function connecter(request: import("@playwright/test").APIRequestContext, email: string) {
  const reponse = await request.post("/api/auth/login", { data: { email, password: "Demo1234" } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("ATLAS TALENT — accès et parcours minimal", () => {
  test("un Ingénieur n'a pas accès à /api/talent/demandes", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.get("/api/talent/demandes");
    expect(reponse.status()).toBe(403);
  });

  test("un Client crée une demande, l'AI Request Analyzer tourne, puis l'Admin lance le matching", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/talent/demandes", {
      data: { titre: "Testeur QA", description: "Recherche un ingénieur Senior, compétence Playwright, budget 600 EUR/jour." },
    });
    expect(creation.status()).toBe(201);
    const demande = await creation.json();
    // Le provider local (sans clé IA, voir lib/ai/provider.ts) doit avoir
    // extrait au moins la compétence et la séniorité présentes en toutes
    // lettres dans le texte.
    expect(demande.competencesExtraites).toContain("Playwright");
    expect(demande.senioriteSouhaitee).toBe("Senior");
    expect(demande.analyseProvider).toBe("local");

    // Le Client ne voit que ses propres demandes.
    const listeClient = await request.get("/api/talent/demandes");
    expect(listeClient.ok()).toBeTruthy();
    const demandesClient = await listeClient.json();
    expect(demandesClient.some((d: { id: string }) => d.id === demande.id)).toBeTruthy();

    // Un Client ne peut pas déclencher le matching (réservé Admin).
    const matchingRefuse = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(matchingRefuse.status()).toBe(403);

    await connecter(request, "admin-demo@example.com");
    const matching = await request.post(`/api/talent/demandes/${demande.id}/matching`);
    expect(matching.status()).toBe(200);
    const resultat = await matching.json();
    // Aucun profil du seed n'a de CV validé : la shortlist candidate est
    // vide, ce qui doit rester un résultat valide (pas une erreur).
    expect(Array.isArray(resultat.shortlist)).toBeTruthy();
  });
});
