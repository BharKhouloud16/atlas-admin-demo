import { test, expect } from "@playwright/test";
import { buildClientTrustSignal, construireSignauxTrustClient } from "@/lib/talent/client-trust-signals";

// ENGINEER PROFILE V2 — Lot 6 (Trust Client, MVP) : tests unitaires purs de
// lib/talent/client-trust-signals.ts. Couvre exactement les 11 scénarios
// mandatés par le contrat d'implémentation.

test.describe("V2 Lot 6 — buildClientTrustSignal", () => {
  test("1. DECLARE -> wording DECLARE exact", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "DECLARE", mobiliseeEnMission: false });
    expect(signal).not.toBeNull();
    expect(signal!.provenance.label).toBe("Compétence déclarée par l'ingénieur.");
    expect(signal!.provenance.shortLabel).toBe("Déclarée");
  });

  test("2. VERIFIE -> wording VERIFIE exact", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "VERIFIE", mobiliseeEnMission: false });
    expect(signal).not.toBeNull();
    expect(signal!.provenance.label).toBe("Information confirmée en interne par un administrateur Atlas.");
    expect(signal!.provenance.shortLabel).toBe("Confirmée par Atlas");
  });

  test("3. VERIFIE -> ne produit jamais le wording DECLARE", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "VERIFIE", mobiliseeEnMission: false });
    expect(signal!.provenance.label).not.toContain("déclarée");
    expect(signal!.provenance.shortLabel).not.toBe("Déclarée");
  });

  test("4. INFERE -> exclu (null)", () => {
    expect(buildClientTrustSignal({ competence: "React", statut: "INFERE", mobiliseeEnMission: false })).toBeNull();
  });

  test("5. INCONNU -> exclu (null)", () => {
    expect(buildClientTrustSignal({ competence: "React", statut: "INCONNU", mobiliseeEnMission: false })).toBeNull();
  });

  test("6. Mission terminée -> mobiliseeEnMission true produit le signal de mobilisation", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "DECLARE", mobiliseeEnMission: true });
    expect(signal!.mobilisation).not.toBeNull();
    expect(signal!.mobilisation!.label).toBe("Compétence mobilisée dans une mission réalisée pour un client Atlas.");
  });

  test("7. Mission non terminée -> mobiliseeEnMission false -> aucun signal de mobilisation", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "DECLARE", mobiliseeEnMission: false });
    expect(signal!.mobilisation).toBeNull();
  });

  test("8. aucune MissionCompetence -> false -> aucun signal de mobilisation", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "VERIFIE", mobiliseeEnMission: false });
    expect(signal!.mobilisation).toBeNull();
  });

  test("9. combinaison DECLARE + mission -> deux signaux maximum (provenance + mobilisation)", () => {
    const signal = buildClientTrustSignal({ competence: "React", statut: "DECLARE", mobiliseeEnMission: true });
    expect(signal!.provenance).toBeTruthy();
    expect(signal!.mobilisation).toBeTruthy();
    expect(Object.keys(signal!)).toEqual(["competence", "provenance", "mobilisation"]); // jamais un 3e champ
  });

  test("10. combinaison VERIFIE + mission -> deux signaux maximum", () => {
    const signal = buildClientTrustSignal({ competence: "Kubernetes", statut: "VERIFIE", mobiliseeEnMission: true });
    expect(signal!.provenance.shortLabel).toBe("Confirmée par Atlas");
    expect(signal!.mobilisation!.shortLabel).toBe("Mission réalisée");
  });

  test("11. aucun signal éligible -> compétence non retournée par construireSignauxTrustClient", () => {
    const resultat = construireSignauxTrustClient([
      { competence: "React", statut: "INFERE", mobiliseeEnMission: true },
      { competence: "Kubernetes", statut: "INCONNU", mobiliseeEnMission: false },
    ]);
    expect(resultat).toEqual([]);
  });
});

test.describe("V2 Lot 6 — construireSignauxTrustClient (agrégation)", () => {
  test("filtre les compétences non éligibles et conserve les éligibles", () => {
    const resultat = construireSignauxTrustClient([
      { competence: "React", statut: "DECLARE", mobiliseeEnMission: true },
      { competence: "COBOL-legacy", statut: "INFERE", mobiliseeEnMission: true },
      { competence: "Kubernetes", statut: "VERIFIE", mobiliseeEnMission: false },
    ]);
    expect(resultat.map((s) => s.competence)).toEqual(["Kubernetes", "React"]); // ordre alphabétique déterministe
  });

  test("plafonne à 5 compétences, jamais un classement caché (ordre alphabétique strict)", () => {
    const competences = ["Zoo", "Yak", "Xi", "Wifi", "Vue", "Terraform"].map((c) => ({
      competence: c,
      statut: "DECLARE",
      mobiliseeEnMission: false,
    }));
    const resultat = construireSignauxTrustClient(competences);
    expect(resultat).toHaveLength(5);
    expect(resultat.map((s) => s.competence)).toEqual(["Terraform", "Vue", "Wifi", "Xi", "Yak"]);
  });

  test("liste vide -> résultat vide", () => {
    expect(construireSignauxTrustClient([])).toEqual([]);
  });
});
