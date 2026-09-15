import { test, expect } from "@playwright/test";
import { detecterRecurrences } from "@/lib/client-profile/recurrence";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation.
// Fonction pure : détection déterministe de récurrence à travers plusieurs
// ClientNeed distincts — un SIGNAL uniquement, jamais un fait confirmé.

test.describe("COMPANY ATLAS LOT 4 — detecterRecurrences", () => {
  test("aucune occurrence répétée -> aucun signal", () => {
    const faits = [{ cle: "ROLE", valeur: "QA", needId: "need-1" }];
    expect(detecterRecurrences(faits)).toEqual([]);
  });

  test("même clé/valeur dans le MÊME besoin, deux fois -> ne compte que pour 1 occurrence (needId dédupliqué)", () => {
    const faits = [
      { cle: "ROLE", valeur: "QA", needId: "need-1" },
      { cle: "ROLE", valeur: "QA", needId: "need-1" },
    ];
    expect(detecterRecurrences(faits)).toEqual([]);
  });

  test("même clé/valeur dans 2 besoins DISTINCTS -> signal émis, seuil atteint", () => {
    const faits = [
      { cle: "ROLE", valeur: "QA Automation", needId: "need-1" },
      { cle: "ROLE", valeur: "QA Automation", needId: "need-2" },
    ];
    const signaux = detecterRecurrences(faits);
    expect(signaux.length).toBe(1);
    expect(signaux[0]).toMatchObject({ cle: "ROLE", occurrences: 2 });
    expect(signaux[0].needIds.sort()).toEqual(["need-1", "need-2"]);
  });

  test("comparaison normalisée (casse/espaces) -> reconnue comme la même valeur récurrente", () => {
    const faits = [
      { cle: "ROLE", valeur: "QA Automation", needId: "need-1" },
      { cle: "ROLE", valeur: "  qa automation  ", needId: "need-2" },
    ];
    expect(detecterRecurrences(faits).length).toBe(1);
  });

  test("clé hors périmètre (ex. BUDGET_MONTANT) -> jamais considérée, quelle que soit la récurrence", () => {
    const faits = [
      { cle: "BUDGET_MONTANT", valeur: "500", needId: "need-1" },
      { cle: "BUDGET_MONTANT", valeur: "500", needId: "need-2" },
    ];
    expect(detecterRecurrences(faits)).toEqual([]);
  });

  test("plusieurs signaux -> triés par occurrences décroissantes", () => {
    const faits = [
      { cle: "ROLE", valeur: "QA", needId: "n1" },
      { cle: "ROLE", valeur: "QA", needId: "n2" },
      { cle: "COMPETENCE", valeur: "Java", needId: "n1" },
      { cle: "COMPETENCE", valeur: "Java", needId: "n2" },
      { cle: "COMPETENCE", valeur: "Java", needId: "n3" },
    ];
    const signaux = detecterRecurrences(faits);
    expect(signaux[0]).toMatchObject({ cle: "COMPETENCE", occurrences: 3 });
    expect(signaux[1]).toMatchObject({ cle: "ROLE", occurrences: 2 });
  });

  test("jamais un fait confirmé — la fonction ne retourne qu'un signal en lecture, aucune écriture, aucun objet ClientProfileFact", () => {
    const faits = [
      { cle: "ROLE", valeur: "QA", needId: "n1" },
      { cle: "ROLE", valeur: "QA", needId: "n2" },
    ];
    const signaux = detecterRecurrences(faits);
    expect(Object.keys(signaux[0])).toEqual(["cle", "valeur", "occurrences", "needIds"]);
    expect(signaux[0]).not.toHaveProperty("statut");
  });
});
