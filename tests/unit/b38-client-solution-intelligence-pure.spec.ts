import { test, expect } from "@playwright/test";
import { adapterEnOptionClient } from "@/lib/client-solution/adapter";
import { comparerOptions } from "@/lib/client-solution/comparaison";
import type { Recommandation } from "@/lib/talent/recommendation-engine";
import type { OptionClientSafe } from "@/lib/client-solution/types";

// COMPANY ATLAS — V2.1-B (16/09/2026) : tests des fonctions pures C3 Solution
// Intelligence (lib/client-solution/*). Aucune DB, aucun HTTP, aucune route
// exercée ici — voir tests/unit/b37-client-solution-intelligence-schema.spec.ts
// pour le socle data (V2.1-A) et les futurs tests d'API/sécurité réseau en
// V2.1-D. Ce fichier couvre spécifiquement la frontière de sécurité
// Talent -> Client (adapterEnOptionClient) et la comparaison déterministe
// (comparerOptions).

function creerRecommandationDeTest(overrides: Partial<Recommandation> = {}): Recommandation {
  return {
    profilId: "profil-de-test",
    recommandation: "Candidat recommandé pour revue humaine",
    rationale: ["Compétence Kubernetes retrouvée chez ce candidat"],
    competencesCorrespondantes: ["Kubernetes"],
    preuves: [],
    niveauConfiance: "MOYENNE",
    criteresManquants: ["Localisation"],
    contradictions: [],
    facteursDefavorables: [],
    scoreMatching: 72,
    statutMatching: "PARTIEL",
    ...overrides,
  };
}

function creerOption(overrides: Partial<OptionClientSafe> = {}): OptionClientSafe {
  return {
    typeSolution: "TALENT",
    competencesCorrespondantes: ["Kubernetes"],
    niveauConfiance: "MOYENNE",
    rationale: ["Explication factuelle"],
    criteresAPreciser: [],
    disponibilite: { statut: "UNKNOWN", detail: null },
    ...overrides,
  };
}

test.describe("V2.1-B — adapterEnOptionClient() : frontière de sécurité Talent -> Client", () => {
  test("Sécurité — aucun champ interdit ne traverse la frontière, même injecté volontairement dans tous les champs (y compris imbriqués)", () => {
    const poison = "POISON_9f3e2b1a_";
    const recommandation: Recommandation = {
      profilId: poison + "profilId",
      recommandation: poison + "recommandation",
      rationale: [poison + "rationale1"],
      competencesCorrespondantes: ["Kubernetes"],
      preuves: [{ source: poison + "source", detail: poison + "detail", createdAt: new Date(), niveau: 3 } as unknown as Recommandation["preuves"][number]],
      niveauConfiance: "MOYENNE",
      criteresManquants: [poison + "critere"],
      contradictions: [poison + "contradiction1", poison + "contradiction2"],
      facteursDefavorables: [poison + "facteur1"],
      scoreMatching: 999999,
      statutMatching: "MATCH",
    };

    const sortie = adapterEnOptionClient(recommandation, poison + "disponibilite");
    const serialise = JSON.stringify(sortie);

    // Champs strictement interdits — aucune trace, même partielle.
    expect(serialise).not.toContain("profilId");
    expect(serialise).not.toContain(poison + "recommandation");
    expect(serialise).not.toContain(poison + "source");
    expect(serialise).not.toContain(poison + "detail");
    expect(serialise).not.toContain(poison + "contradiction1");
    expect(serialise).not.toContain(poison + "contradiction2");
    expect(serialise).not.toContain(poison + "facteur1");
    expect(serialise).not.toContain("999999");
    expect(serialise).not.toContain("PARTIEL");
    expect(serialise).not.toContain("MATCH");
    expect(serialise).not.toContain(poison + "disponibilite"); // texte libre non reconnu -> UNKNOWN, jamais recopié tel quel

    // Champs explicitement autorisés par l'allowlist — doivent apparaître
    // (preuve que la fonction ne supprime pas aussi les champs légitimes).
    expect(serialise).toContain(poison + "rationale1");
    expect(serialise).toContain(poison + "critere");
    expect(serialise).toContain("Kubernetes");

    // Vérification structurelle complète, à toute profondeur — pas
    // seulement quelques propriétés connues au premier niveau.
    const clesInterdites = [
      "profilid",
      "preuves",
      "scorematching",
      "contradictions",
      "facteursdefavorables",
      "statutmatching",
      "nom",
      "prenom",
      "email",
      "telephone",
      "tjm",
      "cout",
      "marge",
      "montantsaisi",
    ];
    function scannerCles(valeur: unknown, chemin: string[] = []) {
      if (valeur === null || typeof valeur !== "object") return;
      for (const [cle, sousValeur] of Object.entries(valeur as Record<string, unknown>)) {
        expect(clesInterdites, `clé interdite trouvée à ${[...chemin, cle].join(".")}`).not.toContain(cle.toLowerCase());
        scannerCles(sousValeur, [...chemin, cle]);
      }
    }
    scannerCles(sortie);
  });

  test("Pureté — n'utilise ni DB, ni HTTP, ni Date.now/Math.random, et ne mute jamais son entrée", () => {
    const recommandation = creerRecommandationDeTest();
    const copieOriginale = JSON.parse(JSON.stringify(recommandation));
    adapterEnOptionClient(recommandation, "disponible immédiatement");
    expect(recommandation).toEqual(copieOriginale);
  });

  test("Pureté — même entrée produit toujours la même sortie (déterminisme)", () => {
    const recommandation = creerRecommandationDeTest();
    const sortie1 = adapterEnOptionClient(recommandation, "disponible immédiatement");
    const sortie2 = adapterEnOptionClient(recommandation, "disponible immédiatement");
    expect(sortie1).toEqual(sortie2);
  });

  test("UNKNOWN — disponibilité absente ou non interprétable devient UNKNOWN, jamais une fausse certitude", () => {
    const recommandation = creerRecommandationDeTest();
    expect(adapterEnOptionClient(recommandation, null).disponibilite).toEqual({ statut: "UNKNOWN", detail: null });
    expect(adapterEnOptionClient(recommandation, "").disponibilite.statut).toBe("UNKNOWN");
    expect(adapterEnOptionClient(recommandation, "texte libre ambigu sans structure reconnue").disponibilite.statut).toBe("UNKNOWN");
  });

  test("Disponibilité interprétable — formulation fiable reconnue, tolérante à la casse et aux accents", () => {
    const recommandation = creerRecommandationDeTest();
    expect(adapterEnOptionClient(recommandation, "Disponible IMMEDIATEMENT").disponibilite.statut).toBe("CONNUE");
    expect(adapterEnOptionClient(recommandation, "disponible immédiat").disponibilite.statut).toBe("CONNUE");
    expect(adapterEnOptionClient(recommandation, "disponible sous 2 semaines").disponibilite.statut).toBe("CONNUE");
  });

  test("Allowlist — les champs autorisés (compétences, confiance, rationale, critères à préciser) sont bien transmis", () => {
    const recommandation = creerRecommandationDeTest({
      competencesCorrespondantes: ["Kubernetes", "Terraform"],
      niveauConfiance: "HAUTE",
      rationale: ["Bonne correspondance globale"],
      criteresManquants: ["Budget"],
    });
    const sortie = adapterEnOptionClient(recommandation);
    expect(sortie).toEqual({
      typeSolution: "TALENT",
      competencesCorrespondantes: ["Kubernetes", "Terraform"],
      niveauConfiance: "HAUTE",
      rationale: ["Bonne correspondance globale"],
      criteresAPreciser: ["Budget"],
      disponibilite: { statut: "UNKNOWN", detail: null },
    });
  });
});

test.describe("V2.1-B — comparerOptions() : comparaison déterministe et recommandation", () => {
  test("0 option -> AUCUNE_OPTION, aucune recommandation forcée", () => {
    const resultat = comparerOptions([]);
    expect(resultat.optionsOrdonnees).toEqual([]);
    expect(resultat.recommandation).toBeNull();
    expect(resultat.raisonAbsenceRecommandation).toBe("AUCUNE_OPTION");
  });

  test("1 option avec signal réel -> recommandation produite", () => {
    const resultat = comparerOptions([creerOption()]);
    expect(resultat.optionsOrdonnees.length).toBe(1);
    expect(resultat.optionsOrdonnees[0].rang).toBe(1);
    expect(resultat.recommandation?.rangRecommande).toBe(1);
    expect(resultat.raisonAbsenceRecommandation).toBeNull();
  });

  test("1 option sans aucun signal exploitable (0 compétence, confiance INCONNUE) -> aucune recommandation forcée, mais l'option reste visible", () => {
    const resultat = comparerOptions([creerOption({ competencesCorrespondantes: [], niveauConfiance: "INCONNUE" })]);
    expect(resultat.recommandation).toBeNull();
    expect(resultat.raisonAbsenceRecommandation).toBe("DONNEES_INSUFFISANTES");
    expect(resultat.optionsOrdonnees.length).toBe(1);
  });

  test("plus de compétences correspondantes -> mieux classée en premier critère", () => {
    const faible = creerOption({ competencesCorrespondantes: ["Kubernetes"] });
    const forte = creerOption({ competencesCorrespondantes: ["Kubernetes", "Terraform"] });
    const resultat = comparerOptions([faible, forte]);
    expect(resultat.optionsOrdonnees[0].competencesCorrespondantes).toEqual(["Kubernetes", "Terraform"]);
    expect(resultat.recommandation?.rangRecommande).toBe(1);
  });

  test("à compétences égales, la confiance qualitative la plus haute départage", () => {
    const basse = creerOption({ niveauConfiance: "BASSE" });
    const haute = creerOption({ niveauConfiance: "HAUTE" });
    const resultat = comparerOptions([basse, haute]);
    expect(resultat.optionsOrdonnees[0].niveauConfiance).toBe("HAUTE");
  });

  test("à compétences et confiance égales, moins de critères à préciser départage", () => {
    const plusIncertaine = creerOption({ criteresAPreciser: ["Budget", "Localisation"] });
    const plusCertaine = creerOption({ criteresAPreciser: [] });
    const resultat = comparerOptions([plusIncertaine, plusCertaine]);
    expect(resultat.optionsOrdonnees[0].criteresAPreciser).toEqual([]);
  });

  test("options strictement équivalentes -> jamais un gagnant inventé, alternatives listées explicitement", () => {
    const a = creerOption();
    const b = creerOption();
    const resultat = comparerOptions([a, b]);
    expect(resultat.recommandation?.rangsAlternativesEquivalentes).toEqual([2]);
  });

  test("déterminisme — même entrée produit toujours le même résultat", () => {
    const options = [
      creerOption({ competencesCorrespondantes: ["A"] }),
      creerOption({ competencesCorrespondantes: ["A", "B"] }),
      creerOption({ niveauConfiance: "HAUTE" }),
    ];
    const r1 = comparerOptions(options);
    const r2 = comparerOptions(options);
    expect(r1).toEqual(r2);
  });

  test("ne mute jamais son entrée", () => {
    const options = [creerOption(), creerOption({ competencesCorrespondantes: ["X"] })];
    const copie = JSON.parse(JSON.stringify(options));
    comparerOptions(options);
    expect(options).toEqual(copie);
  });

  test("critères à préciser jamais traités comme satisfaits ou non satisfaits — simplement listés tels quels", () => {
    const resultat = comparerOptions([creerOption({ criteresAPreciser: ["Budget", "Localisation"] })]);
    expect(resultat.recommandation?.inconnuesImportantes).toEqual(["Budget", "Localisation"]);
  });

  test("la justification ne mentionne jamais une comparaison nommée à une autre option (aucune fuite indirecte)", () => {
    const resultat = comparerOptions([creerOption(), creerOption({ competencesCorrespondantes: ["Autre"] })]);
    const justification = resultat.recommandation?.justification ?? "";
    expect(justification.toLowerCase()).not.toContain("meilleur");
    expect(justification.toLowerCase()).not.toContain("candidat");
    expect(justification.toLowerCase()).not.toContain("profil");
  });
});
