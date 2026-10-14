import { test, expect } from "@playwright/test";
import { verifierResultatVsNeed, type CritereEnEntree } from "@/lib/outcome/verification";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Tests de la fonction PURE verifierResultatVsNeed() — aucun accès base,
// aucun appel réseau. Couvre la RÈGLE ABSOLUE du mandat A6.1 §15/§16 :
// une absence de preuve ne devient jamais OBTENU/NON_OBTENU, ainsi que
// l'agrégation déterministe du statut global.

function critere(partiel: Partial<CritereEnEntree> = {}): CritereEnEntree {
  return {
    sourceFaitId: "fait-1",
    criterionText: "Taux de couverture >= 90%",
    statutPropose: "OBTENU",
    methodes: ["VERIFIE_HUMAIN"],
    evidences: [{ source: "Rapport de tests CI" }],
    ...partiel,
  };
}

test.describe("COMPANY ATLAS A6.1 — verifierResultatVsNeed (règle absolue + agrégation)", () => {
  test("aucun critère -> overallStatus INDETERMINABLE, jamais OBTENU par défaut", () => {
    const resultat = verifierResultatVsNeed([]);
    expect(resultat.overallStatus).toBe("INDETERMINABLE");
    expect(resultat.criteria).toHaveLength(0);
  });

  test("RÈGLE ABSOLUE — aucune preuve => INDETERMINABLE/INCONNU, quel que soit le statut proposé (OBTENU demandé)", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "OBTENU", evidences: [] })]);
    expect(resultat.criteria[0].status).toBe("INDETERMINABLE");
    expect(resultat.criteria[0].confidence).toBe("INCONNU");
    expect(resultat.overallStatus).toBe("INDETERMINABLE");
  });

  test("RÈGLE ABSOLUE — preuve présente mais aucune méthode renseignée => INDETERMINABLE/INCONNU", () => {
    const resultat = verifierResultatVsNeed([critere({ methodes: [], evidences: [{ source: "quelque chose" }] })]);
    expect(resultat.criteria[0].status).toBe("INDETERMINABLE");
    expect(resultat.criteria[0].confidence).toBe("INCONNU");
  });

  test("VERIFIE_HUMAIN + preuve => le statut proposé (OBTENU) est retenu, confiance VERIFIE", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"] })]);
    expect(resultat.criteria[0].status).toBe("OBTENU");
    expect(resultat.criteria[0].confidence).toBe("VERIFIE");
    expect(resultat.criteria[0].verificationMethod).toBe("VERIFIE_HUMAIN");
  });

  test("MESURE_SYSTEME + preuve => confiance VERIFIE également (mesure objective)", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "NON_OBTENU", methodes: ["MESURE_SYSTEME"] })]);
    expect(resultat.criteria[0].status).toBe("NON_OBTENU");
    expect(resultat.criteria[0].confidence).toBe("VERIFIE");
  });

  test("DECLARE_CLIENT + preuve => statut proposé retenu, confiance DECLARE", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "NON_OBTENU", methodes: ["DECLARE_CLIENT"] })]);
    expect(resultat.criteria[0].status).toBe("NON_OBTENU");
    expect(resultat.criteria[0].confidence).toBe("DECLARE");
  });

  test("INFERE_IA seul — JAMAIS suffisant à conclure OBTENU, ramené à INDETERMINABLE malgré le statut proposé", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "OBTENU", methodes: ["INFERE_IA"] })]);
    expect(resultat.criteria[0].status).toBe("INDETERMINABLE");
    expect(resultat.criteria[0].confidence).toBe("INFERE");
    expect(resultat.criteria[0].verificationMethod).toBe("INFERE_IA");
  });

  test("INFERE_IA seul — également ramené à INDETERMINABLE pour un statut proposé NON_OBTENU", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "NON_OBTENU", methodes: ["INFERE_IA"] })]);
    expect(resultat.criteria[0].status).toBe("INDETERMINABLE");
  });

  test("VERIFIE_HUMAIN + INFERE_IA ensemble — la méthode la plus forte gagne, jamais capé par l'IA", () => {
    const resultat = verifierResultatVsNeed([critere({ statutPropose: "OBTENU", methodes: ["INFERE_IA", "VERIFIE_HUMAIN"] })]);
    expect(resultat.criteria[0].status).toBe("OBTENU");
    expect(resultat.criteria[0].verificationMethod).toBe("VERIFIE_HUMAIN");
    expect(resultat.criteria[0].confidence).toBe("VERIFIE");
  });

  test("agrégation — tous les critères OBTENU => overallStatus OBTENU", () => {
    const resultat = verifierResultatVsNeed([
      critere({ sourceFaitId: "a", statutPropose: "OBTENU" }),
      critere({ sourceFaitId: "b", statutPropose: "OBTENU" }),
    ]);
    expect(resultat.overallStatus).toBe("OBTENU");
  });

  test("agrégation — tous NON_OBTENU => overallStatus NON_OBTENU", () => {
    const resultat = verifierResultatVsNeed([
      critere({ sourceFaitId: "a", statutPropose: "NON_OBTENU" }),
      critere({ sourceFaitId: "b", statutPropose: "NON_OBTENU" }),
    ]);
    expect(resultat.overallStatus).toBe("NON_OBTENU");
  });

  test("agrégation — mélange OBTENU + NON_OBTENU => overallStatus PARTIELLEMENT_OBTENU", () => {
    const resultat = verifierResultatVsNeed([
      critere({ sourceFaitId: "a", statutPropose: "OBTENU" }),
      critere({ sourceFaitId: "b", statutPropose: "NON_OBTENU" }),
    ]);
    expect(resultat.overallStatus).toBe("PARTIELLEMENT_OBTENU");
  });

  test("agrégation — mélange OBTENU + INDETERMINABLE (aucun NON_OBTENU confirmé) => overallStatus INDETERMINABLE, jamais OBTENU par optimisme", () => {
    const resultat = verifierResultatVsNeed([
      critere({ sourceFaitId: "a", statutPropose: "OBTENU" }),
      critere({ sourceFaitId: "b", evidences: [] }), // force INDETERMINABLE
    ]);
    expect(resultat.overallStatus).toBe("INDETERMINABLE");
  });

  test("agrégation — mélange NON_OBTENU + INDETERMINABLE => overallStatus PARTIELLEMENT_OBTENU (un échec confirmé reste un échec partiel connu, même si un autre critère est incertain)", () => {
    const resultat = verifierResultatVsNeed([
      critere({ sourceFaitId: "a", statutPropose: "NON_OBTENU" }),
      critere({ sourceFaitId: "b", evidences: [] }), // force INDETERMINABLE
    ]);
    expect(resultat.overallStatus).toBe("PARTIELLEMENT_OBTENU");
  });

  test("déterminisme — deux appels avec les mêmes entrées produisent exactement le même résultat", () => {
    const entree = [critere({ sourceFaitId: "a" }), critere({ sourceFaitId: "b", statutPropose: "NON_OBTENU", methodes: ["DECLARE_CLIENT"] })];
    const r1 = verifierResultatVsNeed(entree);
    const r2 = verifierResultatVsNeed(entree);
    expect(r1).toEqual(r2);
  });
});
