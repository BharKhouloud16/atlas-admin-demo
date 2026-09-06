import { test, expect } from "@playwright/test";
import { scorerProfil, classerProfils, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";

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

// ATLAS TALENT V2 — 8 facteurs (compétences/séniorité/expérience/secteur/
// localisation/mobilité/disponibilité/budget), chacun avec un statut
// explicite MATCH/PARTIEL/INSUFFISANT/INCOMPATIBLE. Les critères viennent
// désormais de la DemandeTalent vérifiée par l'Admin (voir PATCH
// /api/talent/demandes/[id]) — ce fichier ne teste que lib/talent/matching.ts
// en isolation (pas de DB, pas de serveur), complémentaire de
// tests/api/talent-criteres.spec.ts qui vérifie le chemin complet.
test.describe("Matching Engine V2 — 8 facteurs", () => {
  const profilComplet: ProfilPourMatching = {
    id: "p-complet",
    competences: ["Kubernetes", "Terraform"],
    seniorite: "Expert",
    disponibilite: "Disponible immédiatement",
    cvValide: true,
    tjmEstime: 700,
    anneesExperience: 10,
    paysResidence: "Lyon",
  };
  const criteresComplets = {
    competencesRecherchees: ["Kubernetes", "Terraform"],
    senioriteSouhaitee: "Expert",
    budgetTjmMax: 750,
    anneesExperienceMin: 8,
    secteurActivite: "Assurance",
    localisation: "Lyon",
    mobilite: "Hybride",
    disponibiliteSouhaitee: "Sous 1 mois",
  };

  test("1. compétences : MATCH si toutes présentes, PARTIEL si partielles, INSUFFISANT si non précisées", () => {
    const toutes = scorerProfil(profilComplet, criteresComplets);
    expect(toutes.facteurs.competences.statut).toBe("MATCH");

    const partiel = scorerProfil(profilComplet, { ...criteresComplets, competencesRecherchees: ["Kubernetes", "Ansible"] });
    expect(partiel.facteurs.competences.statut).toBe("PARTIEL");

    const nonPrecisees = scorerProfil(profilComplet, { ...criteresComplets, competencesRecherchees: [] });
    expect(nonPrecisees.facteurs.competences.statut).toBe("INSUFFISANT");
  });

  test("2. séniorité : MATCH si identique, PARTIEL si écart, INSUFFISANT si non renseignée", () => {
    const identique = scorerProfil(profilComplet, criteresComplets);
    expect(identique.facteurs.seniorite.statut).toBe("MATCH");

    const ecart = scorerProfil(profilComplet, { ...criteresComplets, senioriteSouhaitee: "Junior" });
    expect(ecart.facteurs.seniorite.statut).toBe("PARTIEL");

    const nonRenseignee = scorerProfil({ ...profilComplet, seniorite: null }, criteresComplets);
    expect(nonRenseignee.facteurs.seniorite.statut).toBe("INSUFFISANT");
  });

  test("3. expérience : MATCH si suffisante, PARTIEL si insuffisante, INSUFFISANT si non renseignée", () => {
    const suffisante = scorerProfil(profilComplet, criteresComplets);
    expect(suffisante.facteurs.experience.statut).toBe("MATCH");

    const insuffisante = scorerProfil({ ...profilComplet, anneesExperience: 2 }, criteresComplets);
    expect(insuffisante.facteurs.experience.statut).toBe("PARTIEL");

    const nonRenseignee = scorerProfil({ ...profilComplet, anneesExperience: null }, criteresComplets);
    expect(nonRenseignee.facteurs.experience.statut).toBe("INSUFFISANT");
  });

  test("4. secteur : toujours INSUFFISANT (aucune donnée de secteur collectée côté profil) — jamais un score forcé à 0", () => {
    const resultat = scorerProfil(profilComplet, criteresComplets);
    expect(resultat.facteurs.secteur.statut).toBe("INSUFFISANT");
    expect(resultat.facteurs.secteur.points).toBeGreaterThan(0);
  });

  test("5. localisation : MATCH si compatible, PARTIEL si différente sans exigence sur site, INCOMPATIBLE (bloquant) si sur site exigé ailleurs", () => {
    const compatible = scorerProfil(profilComplet, criteresComplets);
    expect(compatible.facteurs.localisation.statut).toBe("MATCH");

    const differenteSansExigence = scorerProfil(profilComplet, { ...criteresComplets, localisation: "Marseille" });
    expect(differenteSansExigence.facteurs.localisation.statut).toBe("PARTIEL");

    const surSiteAilleurs = scorerProfil(profilComplet, { ...criteresComplets, localisation: "Marseille", mobilite: "Sur site" });
    expect(surSiteAilleurs.facteurs.localisation.statut).toBe("INCOMPATIBLE");
    expect(surSiteAilleurs.criteresBloquants.length).toBeGreaterThan(0);
  });

  test("6. mobilité : toujours INSUFFISANT (aucune préférence de mobilité collectée côté profil)", () => {
    const resultat = scorerProfil(profilComplet, criteresComplets);
    expect(resultat.facteurs.mobilite.statut).toBe("INSUFFISANT");
    expect(resultat.facteurs.mobilite.points).toBeGreaterThan(0);
  });

  test("7. disponibilité : MATCH si immédiate, INCOMPATIBLE (bloquant) si immédiate exigée mais indisponible, INSUFFISANT si non renseignée", () => {
    const immediate = scorerProfil(profilComplet, criteresComplets);
    expect(immediate.facteurs.disponibilite.statut).toBe("MATCH");

    const exigenceImmediateNonRespectee = scorerProfil(
      { ...profilComplet, disponibilite: "Non disponible immédiatement" },
      { ...criteresComplets, disponibiliteSouhaitee: "Immédiate" }
    );
    expect(exigenceImmediateNonRespectee.facteurs.disponibilite.statut).toBe("INCOMPATIBLE");
    expect(exigenceImmediateNonRespectee.criteresBloquants.length).toBeGreaterThan(0);

    const nonRenseignee = scorerProfil({ ...profilComplet, disponibilite: null }, criteresComplets);
    expect(nonRenseignee.facteurs.disponibilite.statut).toBe("INSUFFISANT");
  });

  test("8. TJM/budget : MATCH si dans le budget, INCOMPATIBLE (bloquant) si largement dépassé, INSUFFISANT si non renseigné", () => {
    const dansLeBudget = scorerProfil(profilComplet, criteresComplets);
    expect(dansLeBudget.facteurs.budget.statut).toBe("MATCH");

    const depasse = scorerProfil({ ...profilComplet, tjmEstime: 1500 }, criteresComplets);
    expect(depasse.facteurs.budget.statut).toBe("INCOMPATIBLE");
    expect(depasse.criteresBloquants.length).toBeGreaterThan(0);

    const nonRenseigne = scorerProfil({ ...profilComplet, tjmEstime: null }, criteresComplets);
    expect(nonRenseigne.facteurs.budget.statut).toBe("INSUFFISANT");
  });

  test("9. critère bloquant : un seul facteur INCOMPATIBLE suffit à faire passer le statut global à INCOMPATIBLE, quel que soit le score", () => {
    const resultat = scorerProfil({ ...profilComplet, tjmEstime: 3000 }, criteresComplets);
    expect(resultat.criteresBloquants.length).toBeGreaterThan(0);
    expect(resultat.statut).toBe("INCOMPATIBLE");
  });

  test("10. donnée manquante : un profil quasi vide reste INSUFFISANT sur les facteurs concernés, jamais un score forcé à 0 ni un statut INCOMPATIBLE non justifié", () => {
    const profilVide: ProfilPourMatching = {
      id: "p-vide",
      competences: [],
      seniorite: null,
      disponibilite: null,
      cvValide: true,
      tjmEstime: null,
      anneesExperience: null,
      paysResidence: null,
    };
    const resultat = scorerProfil(profilVide, criteresComplets);
    expect(resultat.criteresBloquants).toEqual([]);
    expect(resultat.statut).not.toBe("INCOMPATIBLE");
    expect(resultat.score).toBeGreaterThan(0);
    expect(resultat.informationsManquantes.length).toBeGreaterThan(0);
  });

  test("11. le score global reste toujours entre 0 et 100, jamais NaN ni négatif, sur une large variété de combinaisons", () => {
    const profils: ProfilPourMatching[] = [
      profilComplet,
      { id: "a", competences: [], seniorite: null, disponibilite: null, cvValide: false, tjmEstime: null, anneesExperience: null, paysResidence: null },
      { id: "b", competences: ["Java"], seniorite: "Junior", disponibilite: "En mission actuellement chez un autre client", cvValide: true, tjmEstime: 5000, anneesExperience: 0, paysResidence: "Berlin" },
      { id: "c", competences: ["Kubernetes"], seniorite: "Senior", disponibilite: "Non disponible immédiatement", cvValide: true, tjmEstime: 100, anneesExperience: 20, paysResidence: "Lyon" },
    ];
    const criteresVariantes = [
      criteresComplets,
      { competencesRecherchees: [], senioriteSouhaitee: null, budgetTjmMax: null },
      { competencesRecherchees: ["X", "Y", "Z"], senioriteSouhaitee: "Expert", budgetTjmMax: 1, anneesExperienceMin: 15, localisation: "Paris", mobilite: "Sur site", disponibiliteSouhaitee: "Immédiate" },
    ];
    for (const profil of profils) {
      for (const criteres of criteresVariantes) {
        const resultat = scorerProfil(profil, criteres);
        expect(Number.isFinite(resultat.score)).toBe(true);
        expect(resultat.score).toBeGreaterThanOrEqual(0);
        expect(resultat.score).toBeLessThanOrEqual(100);
      }
    }
  });

  test("13. l'ordre des candidats en entrée ne change jamais le résultat calculé pour chacun", () => {
    const profilA = profilComplet;
    const profilB: ProfilPourMatching = { ...profilComplet, id: "p-autre", tjmEstime: 900, seniorite: "Junior" };

    const ordreA = classerProfils([profilA, profilB], criteresComplets);
    const ordreB = classerProfils([profilB, profilA], criteresComplets);

    const parId = (liste: typeof ordreA) => Object.fromEntries(liste.map((r) => [r.profilId, r]));
    const resultatsA = parId(ordreA);
    const resultatsB = parId(ordreB);

    expect(resultatsA[profilA.id].score).toBe(resultatsB[profilA.id].score);
    expect(resultatsA[profilA.id].statut).toBe(resultatsB[profilA.id].statut);
    expect(resultatsA[profilB.id].score).toBe(resultatsB[profilB.id].score);
    expect(resultatsA[profilB.id].statut).toBe(resultatsB[profilB.id].statut);
  });

  test("un candidat parfaitement compatible (8 facteurs) obtient un score supérieur à un candidat très partiellement compatible", () => {
    const parfait = profilComplet;
    const partiel: ProfilPourMatching = {
      id: "p-partiel",
      competences: ["Docker"],
      seniorite: "Junior",
      disponibilite: "Non disponible immédiatement",
      cvValide: true,
      tjmEstime: 1400,
      anneesExperience: 1,
      paysResidence: "Berlin",
    };
    const classement = classerProfils([partiel, parfait], criteresComplets);
    expect(classement[0].profilId).toBe(parfait.id);
    expect(classement[0].score).toBeGreaterThan(classement[1].score);
  });
});

// ATLAS SKILL GRAPH V1 -> Matching Engine V2 (intégration, 06/09/2026) —
// tests purs (pas de DB) de lib/talent/matching.ts avec `competencesGraph`.
// Ne couvre QUE l'intégration : la construction du Skill Graph lui-même
// reste testée dans tests/unit/skill-graph.spec.ts et
// tests/api/skill-graph.spec.ts, non modifiés ici.
test.describe("Matching Engine V2 — intégration Skill Graph V1", () => {
  const criteresJava = { competencesRecherchees: ["Java"], senioriteSouhaitee: null, budgetTjmMax: null };

  function profil(id: string, competencesGraph?: CompetenceGraphPourMatching[]): ProfilPourMatching {
    return { id, competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, competencesGraph };
  }

  function preuveJava(
    statut: CompetenceGraphPourMatching["statut"],
    provenancePrincipale: string | null = "CV"
  ): CompetenceGraphPourMatching {
    return {
      competence: "Java",
      statut,
      confiance: statut === "VERIFIE" ? "HAUTE" : "MOYENNE",
      niveau: statut === "VERIFIE" ? 4 : null,
      anneesExperience: null,
      contexte: null,
      provenancePrincipale,
    };
  }

  // Test 1 : une compétence VERIFIE (correction Admin) est utilisée par le
  // Matching, et l'explication cite son statut réel — jamais une phrase
  // fabriquée.
  test("1. compétence Skill Graph VERIFIE : utilisée par le Matching (MATCH), explication réelle", () => {
    const r = scorerProfil(profil("p1", [preuveJava("VERIFIE", "ADMIN")]), criteresJava);
    expect(r.facteurs.competences.statut).toBe("MATCH");
    expect(r.facteurs.competences.detail).toContain("VERIFIE");
  });

  // Test 2 + Test 6 : une compétence DECLARE est utilisée, son statut et sa
  // provenance réelle (preuve) restent visibles dans l'explication — jamais
  // présentée comme VERIFIE.
  test("2/6. compétence DECLARE : utilisée, statut et provenance réelle conservés (jamais confondue avec VERIFIE)", () => {
    const r = scorerProfil(profil("p2", [preuveJava("DECLARE", "PROFIL")]), criteresJava);
    expect(r.facteurs.competences.statut).toBe("MATCH");
    expect(r.facteurs.competences.detail).toContain("DECLARE");
    expect(r.facteurs.competences.detail).not.toContain("VERIFIE");
    expect(r.facteurs.competences.detail).toContain("preuve : PROFIL");
  });

  // Test 3 : une compétence INFERE (simple suggestion IA) n'est jamais
  // traitée comme un fait établi pour le score — distincte de VERIFIE/DECLARE.
  test("3. compétence INFERE : jamais comptée comme acquise (distincte de VERIFIE/DECLARE)", () => {
    const r = scorerProfil(profil("p3", [preuveJava("INFERE")]), criteresJava);
    expect(r.facteurs.competences.statut).not.toBe("MATCH");
    expect(r.facteurs.competences.valeurObservee).toBe("aucune");
  });

  // Test 4 : une entrée INCONNU (statut/niveau non déterminable) ne devient
  // jamais une compétence certaine.
  test("4. compétence INCONNU : ne devient jamais une compétence certaine", () => {
    const r = scorerProfil(profil("p4", [preuveJava("INCONNU")]), criteresJava);
    expect(r.facteurs.competences.statut).not.toBe("MATCH");
    expect(r.facteurs.competences.valeurObservee).toBe("aucune");
  });

  // Test 5 + Test 8 : un profil SANS Skill Graph (champ absent, pas même un
  // tableau vide) retombe exactement sur le comportement Matching V2 actuel
  // — aucune régression, aucun crash.
  test("5/8. profil sans Skill Graph (champ absent) : comportement Matching V2 historique inchangé", () => {
    const ancienStyle: ProfilPourMatching = { id: "p5", competences: ["Java"], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null };
    const r = scorerProfil(ancienStyle, criteresJava);
    expect(r.facteurs.competences.statut).toBe("MATCH");
    expect(r.facteurs.competences.detail).toBe("1/1 compétence(s) recherchée(s) : Java");
  });

  // Test 7 : deux profils strictement identiques (mêmes données Skill Graph)
  // obtiennent exactement le même score — déterminisme préservé.
  test("7. deux profils identiques (Skill Graph inclus) obtiennent le même score", () => {
    const graph = [preuveJava("VERIFIE", "ADMIN")];
    const rA = scorerProfil(profil("p6a", graph), criteresJava);
    const rB = scorerProfil(profil("p6b", graph), criteresJava);
    expect(rA.score).toBe(rB.score);
    expect(rA.statut).toBe(rB.statut);
  });

  // Test 9 + Test 10 : plusieurs candidats évalués ensemble, chacun avec son
  // propre Skill Graph (ou aucun) — jamais de mélange entre profils, chacun
  // ne voit que ses propres compétences.
  test("9/10. plusieurs candidats : isolation stricte, aucune donnée Skill Graph d'un autre profil n'est utilisée", () => {
    const profilA = profil("p7a", [preuveJava("VERIFIE", "ADMIN")]); // possède Java
    const profilB = profil("p7b", [{ ...preuveJava("VERIFIE", "ADMIN"), competence: "Python" }]); // ne possède PAS Java
    const profilC = profil("p7c"); // pas de Skill Graph du tout

    const classement = classerProfils([profilA, profilB, profilC], criteresJava);
    const parId = Object.fromEntries(classement.map((r) => [r.profilId, r]));

    expect(parId["p7a"].facteurs.competences.statut).toBe("MATCH");
    expect(parId["p7b"].facteurs.competences.statut).not.toBe("MATCH");
    expect(parId["p7c"].facteurs.competences.statut).not.toBe("MATCH");
  });
});
