import { test, expect } from "@playwright/test";
import { construireMarginIntelligence, type MissionPourMarge, type CraPourMarge, type Hypotheses } from "@/lib/finance/margin-intelligence";

// ATLAS FINANCE — Margin Intelligence V1 (Batch 10). Tests purs (pas de DB)
// sur lib/finance/margin-intelligence.ts — complète
// tests/api/margin-intelligence.spec.ts (RBAC critique). Vérifie en
// particulier : réutilisation de calculerTjmCout (jamais une formule de
// coût réimplémentée), marge réelle strictement basée sur des CRA
// ValideeClient, alerte fondée sur la cible propre à chaque mission (jamais
// un seuil absolu global), déterminisme.

const HYP: Hypotheses = { joursAn: 218, chargesSalarie: 0.42, fraisFreelance: 0.08, overhead: 0.15 };

function mission(overrides: Partial<MissionPourMarge> = {}): MissionPourMarge {
  return {
    id: "m1",
    tjmVente: 900,
    nbJours: 10,
    margeCible: 0.3,
    statut: "En cours",
    profilType: "SALARIE",
    profilMontantSaisi: 60000,
    ...overrides,
  };
}

test.describe("Margin Intelligence V1 (lib/finance/margin-intelligence)", () => {
  test("1. marge prévisionnelle : réutilise exactement calculerTjmCout (même formule que /api/missions)", () => {
    const r = construireMarginIntelligence(mission(), [], HYP);
    // tjmCout = 60000*(1+0.42)/218 ; tjmCoutOverhead = tjmCout*1.15 ; ca = 900*10
    const tjmCout = (60000 * 1.42) / 218;
    const coutTotalAttendu = Math.round(tjmCout * 1.15 * 10 * 100) / 100;
    expect(r.previsionnel.statut).toBe("CONNU");
    expect(r.previsionnel.ca).toBe(9000);
    expect(r.previsionnel.coutTotal).toBe(coutTotalAttendu);
  });

  test("2. profil sans type/montant renseigné : coût non calculable, tout INCONNU (jamais un coût inventé)", () => {
    const r = construireMarginIntelligence(mission({ profilType: null, profilMontantSaisi: null }), [], HYP);
    expect(r.previsionnel.statut).toBe("INCONNU");
    expect(r.previsionnel.margePct).toBeNull();
    expect(r.alerte.niveau).toBe("INCONNU");
  });

  test("3. aucun CRA : marge réelle INCONNU, jamais déduite du prévisionnel", () => {
    const r = construireMarginIntelligence(mission(), [], HYP);
    expect(r.reel.statut).toBe("INCONNU");
    expect(r.reel.margePct).toBeNull();
  });

  test("4. CRA non-ValideeClient (Brouillon/Soumise/ValideeAdmin/Rejetee) : ignorés, marge réelle reste INCONNU", () => {
    const cras: CraPourMarge[] = [
      { mois: "2026-01", joursTravailles: 20, statut: "Brouillon" },
      { mois: "2026-02", joursTravailles: 20, statut: "Soumise" },
      { mois: "2026-03", joursTravailles: 20, statut: "ValideeAdmin" },
      { mois: "2026-04", joursTravailles: 20, statut: "Rejetee" },
    ];
    const r = construireMarginIntelligence(mission(), cras, HYP);
    expect(r.reel.statut).toBe("INCONNU");
  });

  test("5. CRA ValideeClient : marge réelle calculée sur la somme des jours facturables uniquement", () => {
    const cras: CraPourMarge[] = [
      { mois: "2026-01", joursTravailles: 12, statut: "ValideeClient" },
      { mois: "2026-02", joursTravailles: 8, statut: "Brouillon" }, // ignoré
      { mois: "2026-03", joursTravailles: 8, statut: "ValideeClient" },
    ];
    const r = construireMarginIntelligence(mission(), cras, HYP);
    expect(r.reel.statut).toBe("CONNU");
    expect(r.reel.joursRetenus).toBe(20); // 12 + 8, jamais les 8 en Brouillon
  });

  test("6. marge négative (perte) : alerte CRITIQUE, jamais masquée", () => {
    const r = construireMarginIntelligence(mission({ tjmVente: 300 }), [], HYP);
    expect(r.previsionnel.margeEuros).toBeLessThan(0);
    expect(r.alerte.niveau).toBe("CRITIQUE");
  });

  test("7. marge positive mais très inférieure à la cible propre à la mission : alerte CRITIQUE", () => {
    // margeCible élevée (0.65) pour forcer un écart > 10 points même avec une marge positive confortable (~50%)
    const r = construireMarginIntelligence(mission({ margeCible: 0.65 }), [], HYP);
    expect(r.previsionnel.margePct).toBeGreaterThan(0);
    expect(r.alerte.niveau).toBe("CRITIQUE");
  });

  test("8. marge légèrement sous la cible : alerte ATTENTION (pas CRITIQUE)", () => {
    // margePct réel ≈ 0.5006 ; cible 0.55 -> écart ≈ -0.049, sous 0 mais pas sous -0.10
    const r = construireMarginIntelligence(mission({ margeCible: 0.55 }), [], HYP);
    expect(r.alerte.niveau).toBe("ATTENTION");
  });

  test("9. marge conforme ou supérieure à la cible : alerte OK", () => {
    const r = construireMarginIntelligence(mission({ margeCible: 0.3 }), [], HYP);
    expect(r.alerte.niveau).toBe("OK");
  });

  test("10. le pourcentage de marge est identique entre prévisionnel et réel (fixe par construction) ; seuls les montants absolus varient avec le volume réellement facturé", () => {
    // Seuls 5 des 10 jours planifiés sont validés Client à date : le réel ne
    // porte que sur ce volume partiel, mais le taux de marge (%) reste le
    // même que le prévisionnel — c'est un invariant du modèle (tjmVente et
    // coût interne sont fixes au niveau de la mission), pas un bug.
    const cras: CraPourMarge[] = [{ mois: "2026-01", joursTravailles: 5, statut: "ValideeClient" }];
    const r = construireMarginIntelligence(mission(), cras, HYP);
    expect(r.reel.statut).toBe("CONNU");
    expect(r.reel.joursRetenus).toBe(5);
    expect(r.reel.ca).toBeLessThan(r.previsionnel.ca as number); // montant absolu moindre (volume partiel)
    expect(r.reel.margePct).toBe(r.previsionnel.margePct); // % de marge inchangé
    expect(r.alerte.label).toContain("réel"); // l'alerte se fonde sur le réel dès qu'il est connu
  });

  test("11. déterminisme strict : même entrée -> même résultat", () => {
    const cras: CraPourMarge[] = [{ mois: "2026-01", joursTravailles: 10, statut: "ValideeClient" }];
    const r1 = construireMarginIntelligence(mission(), cras, HYP);
    const r2 = construireMarginIntelligence(mission(), cras, HYP);
    expect(r1).toEqual(r2);
  });

  test("12. isolation entre missions : les chiffres d'une mission ne contaminent jamais une autre", () => {
    const rA = construireMarginIntelligence(mission({ id: "mA", tjmVente: 900 }), [], HYP);
    const rB = construireMarginIntelligence(mission({ id: "mB", tjmVente: 300 }), [], HYP);
    expect(rA.missionId).toBe("mA");
    expect(rB.missionId).toBe("mB");
    expect(rA.alerte.niveau).toBe("OK");
    expect(rB.alerte.niveau).toBe("CRITIQUE");
  });
});
