import { test, expect } from "@playwright/test";
import { scorerProfil, classerProfils, type ProfilPourMatching } from "@/lib/talent/matching";

// Tests unitaires purs (pas de DB, pas de serveur) du Matching Engine —
// ATLAS TALENT V1 fondations. Vérifie que le score reste explicable
// (motifs non vides) et cohérent avec des cas simples et sans ambiguïté,
// avant tout branchement à une vraie base de profils.

test.describe("Matching Engine (lib/talent/matching)", () => {
  test("un profil qui coche toutes les compétences recherchées score plus haut qu'un profil qui n'en a aucune", async () => {
    const profilIdeal: ProfilPourMatching = {
      id: "p1",
      competences: ["Playwright", "TestNG / JUnit"],
      seniorite: "Senior",
      disponibilite: "Disponible immédiatement",
      cvValide: true,
      tjmEstime: 500,
    };
    const profilSansRapport: ProfilPourMatching = {
      id: "p2",
      competences: ["Docker"],
      seniorite: "Junior",
      disponibilite: "Non disponible immédiatement",
      cvValide: false,
      tjmEstime: 900,
    };

    const criteres = { competencesRecherchees: ["Playwright", "TestNG / JUnit"], senioriteSouhaitee: "Senior", budgetTjmMax: 600 };

    const classement = classerProfils([profilSansRapport, profilIdeal], criteres);

    expect(classement[0].profilId).toBe("p1");
    expect(classement[0].score).toBeGreaterThan(classement[1].score);
    // evidence toujours présente et non vide — jamais une boîte noire
    expect(classement[0].motifs.length).toBeGreaterThan(0);
    for (const motif of classement[0].motifs) {
      expect(motif.detail.length).toBeGreaterThan(0);
    }
  });

  test("un budget dépassé fait baisser le score sans jamais devenir négatif", () => {
    const resultat = scorerProfil(
      { id: "p3", competences: [], seniorite: null, disponibilite: null, cvValide: false, tjmEstime: 2000 },
      { competencesRecherchees: [], senioriteSouhaitee: null, budgetTjmMax: 500 }
    );
    expect(resultat.score).toBeGreaterThanOrEqual(0);
    expect(resultat.score).toBeLessThanOrEqual(100);
  });

  test("la confiance reflète la complétude des données, jamais une note de qualité du profil", () => {
    const complet = scorerProfil(
      { id: "p4", competences: ["Docker"], seniorite: "Senior", disponibilite: "Disponible immédiatement", cvValide: true, tjmEstime: 500 },
      { competencesRecherchees: ["Docker"], senioriteSouhaitee: "Senior", budgetTjmMax: 600 }
    );
    const incomplet = scorerProfil(
      { id: "p5", competences: [], seniorite: null, disponibilite: null, cvValide: false, tjmEstime: null },
      { competencesRecherchees: [], senioriteSouhaitee: null, budgetTjmMax: null }
    );
    expect(complet.confiance).toBeGreaterThan(incomplet.confiance);
    expect(complet.confiance).toBeLessThanOrEqual(1);
    expect(incomplet.confiance).toBeGreaterThanOrEqual(0);
  });
});
