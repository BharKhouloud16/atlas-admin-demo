import { test, expect } from "@playwright/test";
import { deriverCapacites, type FaitPourCapacite } from "@/lib/capability/engine";

// COMPANY ATLAS — A8 : Capability Engine V1 (05/10/2026).
//
// Tests de la fonction PURE deriverCapacites() — aucun accès base, aucun
// appel réseau. Couvre C1/C2/C3/C6 (logique de filtrage) + déterminisme.

function fait(partiel: Partial<FaitPourCapacite> = {}): FaitPourCapacite {
  return {
    id: "fait-1",
    cle: "COMPETENCE",
    valeur: "Java",
    statut: "DECLARE",
    statutActivite: "ACTIVE",
    ...partiel,
  };
}

test.describe("A8 — deriverCapacites (moteur pur)", () => {
  // C1
  test("un fait COMPETENCE actif -> une CapabilityRequirement, texte brut jamais reformulé", () => {
    const resultat = deriverCapacites([fait({ id: "f1", valeur: "Playwright" })]);
    expect(resultat.statut).toBe("DERIVEES");
    expect(resultat.capacites).toHaveLength(1);
    expect(resultat.capacites[0].sourceFaitId).toBe("f1");
    expect(resultat.capacites[0].requiredCapability).toBe("Playwright");
    expect(resultat.capacites[0].provenance).toBe("DECLARE");
  });

  test("plusieurs faits COMPETENCE actifs -> une CapabilityRequirement par fait, jamais collapsées", () => {
    const resultat = deriverCapacites([
      fait({ id: "f1", valeur: "Java" }),
      fait({ id: "f2", valeur: "Playwright" }),
      fait({ id: "f3", valeur: "SQL" }),
    ]);
    expect(resultat.statut).toBe("DERIVEES");
    expect(resultat.capacites).toHaveLength(3);
    expect(resultat.capacites.map((c) => c.requiredCapability).sort()).toEqual(["Java", "Playwright", "SQL"]);
  });

  // C2
  test("aucun fait COMPETENCE -> NO_CAPABILITY_DERIVABLE, jamais une capacité inventée", () => {
    const resultat = deriverCapacites([fait({ cle: "CONTRAINTE", valeur: "Budget limité" })]);
    expect(resultat.statut).toBe("NO_CAPABILITY_DERIVABLE");
    expect(resultat.capacites).toHaveLength(0);
  });

  test("liste de faits vide -> NO_CAPABILITY_DERIVABLE", () => {
    const resultat = deriverCapacites([]);
    expect(resultat.statut).toBe("NO_CAPABILITY_DERIVABLE");
  });

  // C3
  test("CRITERE_REUSSITE présent -> ignoré comme source, comportement déterministe sur les COMPETENCE seules", () => {
    const resultat = deriverCapacites([
      fait({ id: "f1", cle: "COMPETENCE", valeur: "Java" }),
      fait({ id: "f2", cle: "CRITERE_REUSSITE", valeur: "Couverture de tests > 90%" }),
    ]);
    expect(resultat.statut).toBe("DERIVEES");
    expect(resultat.capacites).toHaveLength(1);
    expect(resultat.capacites[0].requiredCapability).toBe("Java");
    expect(resultat.capacites.some((c) => c.requiredCapability.includes("Couverture"))).toBe(false);
  });

  // C6
  test("fait COMPETENCE OBSOLETE -> jamais utilisé comme source ACTIVE", () => {
    const resultat = deriverCapacites([
      fait({ id: "f1", valeur: "Java", statutActivite: "OBSOLETE" }),
      fait({ id: "f2", valeur: "Playwright", statutActivite: "ACTIVE" }),
    ]);
    expect(resultat.statut).toBe("DERIVEES");
    expect(resultat.capacites).toHaveLength(1);
    expect(resultat.capacites[0].sourceFaitId).toBe("f2");
  });

  test("tous les faits COMPETENCE OBSOLETE -> NO_CAPABILITY_DERIVABLE, jamais fabriquée depuis l'historique", () => {
    const resultat = deriverCapacites([fait({ id: "f1", valeur: "Java", statutActivite: "OBSOLETE" })]);
    expect(resultat.statut).toBe("NO_CAPABILITY_DERIVABLE");
  });

  test("fait COMPETENCE avec valeur vide -> jamais une capacité vide créée", () => {
    const resultat = deriverCapacites([fait({ id: "f1", valeur: "" })]);
    expect(resultat.statut).toBe("NO_CAPABILITY_DERIVABLE");
  });

  // Déterminisme
  test("déterminisme — deux appels avec les mêmes entrées produisent exactement le même résultat, même ordre", () => {
    const entree = [fait({ id: "f2", valeur: "B" }), fait({ id: "f1", valeur: "A" })];
    const r1 = deriverCapacites(entree);
    const r2 = deriverCapacites(entree);
    expect(r1).toEqual(r2);
    if (r1.statut === "DERIVEES") {
      expect(r1.capacites.map((c) => c.sourceFaitId)).toEqual(["f1", "f2"]); // tri par id, stable
    }
  });
});
