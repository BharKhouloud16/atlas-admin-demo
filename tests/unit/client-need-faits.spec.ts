import { test, expect } from "@playwright/test";
import { dernierFaitParCle } from "@/lib/client-need/faits";

// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification.
// Fonction pure : "dernière valeur par clé" à partir d'un historique
// ADDITIF (jamais d'écrasement en base — décision CEO LOT 3).

test.describe("COMPANY ATLAS LOT 3 — dernierFaitParCle", () => {
  test("une seule ligne par clé -> renvoyée telle quelle", () => {
    const resultat = dernierFaitParCle([{ cle: "ROLE", valeur: "QA", statut: "DECLARE", createdAt: "2026-01-01T00:00:00Z" }]);
    expect(resultat.get("ROLE")?.valeur).toBe("QA");
  });

  test("plusieurs lignes pour la même clé -> la plus récente par createdAt gagne, jamais la première", () => {
    const resultat = dernierFaitParCle([
      { cle: "SENIORITE", valeur: "Junior", statut: "INFERE", createdAt: "2026-01-01T00:00:00Z" },
      { cle: "SENIORITE", valeur: "Senior", statut: "VERIFIE", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(resultat.get("SENIORITE")?.valeur).toBe("Senior");
    expect(resultat.get("SENIORITE")?.statut).toBe("VERIFIE");
  });

  test("l'ordre d'entrée du tableau n'influence pas le résultat (tri interne par createdAt)", () => {
    const resultat = dernierFaitParCle([
      { cle: "ROLE", valeur: "Nouveau", statut: "VERIFIE", createdAt: "2026-01-05T00:00:00Z" },
      { cle: "ROLE", valeur: "Ancien", statut: "DECLARE", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(resultat.get("ROLE")?.valeur).toBe("Nouveau");
  });

  test("l'historique complet n'est jamais perdu par la fonction elle-même (l'appelant garde le tableau original)", () => {
    const historique = [
      { cle: "ROLE", valeur: "QA", statut: "DECLARE", createdAt: "2026-01-01T00:00:00Z" },
      { cle: "ROLE", valeur: "QA Automation", statut: "VERIFIE", createdAt: "2026-01-02T00:00:00Z" },
    ];
    dernierFaitParCle(historique);
    expect(historique.length).toBe(2); // le tableau d'origine n'est jamais muté
  });

  test("clés distinctes -> chacune sa propre dernière valeur, indépendamment des autres", () => {
    const resultat = dernierFaitParCle([
      { cle: "ROLE", valeur: "QA", statut: "DECLARE", createdAt: "2026-01-01T00:00:00Z" },
      { cle: "LOCALISATION", valeur: "France", statut: "DECLARE", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(resultat.size).toBe(2);
    expect(resultat.get("ROLE")?.valeur).toBe("QA");
    expect(resultat.get("LOCALISATION")?.valeur).toBe("France");
  });
});
