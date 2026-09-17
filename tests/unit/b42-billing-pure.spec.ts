import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import type { Facture, Paiement, StatutFacture } from "@prisma/client";
import { transitionAutorisee, statutDepuisSolde, statutAffiche, LABEL_STATUT_FACTURE } from "@/lib/billing/etat-facture";
import { calculerSolde, soldeEstNul } from "@/lib/billing/solde";
import { calculerMontantsFacture } from "@/lib/billing/montants";
import { reglesApplicables, resoudreRegleFiscale, construireComplianceSnapshot } from "@/lib/billing/regle-fiscale";
import { genererNumeroFacture } from "@/lib/billing/numero";
import { adapterFactureClient } from "@/lib/billing/adapter";

// COMPANY ATLAS — V2.2-B (17/09/2026) : tests des fonctions pures de
// Billing + Fiscal & Regulatory Compliance Foundation (lib/billing/*).
// Aucune DB, aucun HTTP, aucune route exercée ici — voir
// tests/api/b42-billing-api.spec.ts pour le circuit complet (RBAC, IDOR,
// concurrence, idempotence). Même découpage que V2.1-B
// (tests/unit/b38-client-solution-intelligence-pure.spec.ts) : socle pur
// d'abord, réseau ensuite.

const TOUS_STATUTS: StatutFacture[] = ["BROUILLON", "VALIDEE", "ENVOYEE", "PARTIELLEMENT_PAYEE", "PAYEE", "ANNULEE"];

test.describe("V2.2-B — etat-facture.ts : machine d'état de Facture", () => {
  test("transitions autorisées explicites du mandat", () => {
    expect(transitionAutorisee("BROUILLON", "VALIDEE")).toBe(true);
    expect(transitionAutorisee("VALIDEE", "ENVOYEE")).toBe(true);
    expect(transitionAutorisee("ENVOYEE", "PARTIELLEMENT_PAYEE")).toBe(true);
    expect(transitionAutorisee("ENVOYEE", "PAYEE")).toBe(true);
    expect(transitionAutorisee("PARTIELLEMENT_PAYEE", "PAYEE")).toBe(true);
    expect(transitionAutorisee("BROUILLON", "ANNULEE")).toBe(true);
    expect(transitionAutorisee("VALIDEE", "ANNULEE")).toBe(true);
    expect(transitionAutorisee("ENVOYEE", "ANNULEE")).toBe(true);
    expect(transitionAutorisee("PARTIELLEMENT_PAYEE", "ANNULEE")).toBe(true);
  });

  test("transitions explicitement interdites par le mandat CEO — jamais PAYEE -> BROUILLON, jamais ANNULEE -> PAYEE", () => {
    expect(transitionAutorisee("PAYEE", "BROUILLON")).toBe(false);
    expect(transitionAutorisee("ANNULEE", "PAYEE")).toBe(false);
  });

  test("PAYEE et ANNULEE sont des états terminaux — aucune transition sortante, quelle que soit la cible", () => {
    for (const cible of TOUS_STATUTS) {
      expect(transitionAutorisee("PAYEE", cible)).toBe(false);
      expect(transitionAutorisee("ANNULEE", cible)).toBe(false);
    }
  });

  test("aucune transition arrière n'est jamais autorisée (pas seulement les deux exemples cités par le mandat)", () => {
    const arrieres: [StatutFacture, StatutFacture][] = [
      ["VALIDEE", "BROUILLON"],
      ["ENVOYEE", "VALIDEE"],
      ["ENVOYEE", "BROUILLON"],
      ["PARTIELLEMENT_PAYEE", "ENVOYEE"],
      ["PARTIELLEMENT_PAYEE", "VALIDEE"],
      ["PARTIELLEMENT_PAYEE", "BROUILLON"],
    ];
    for (const [depuis, vers] of arrieres) {
      expect(transitionAutorisee(depuis, vers)).toBe(false);
    }
  });

  test("statutDepuisSolde — solde <= 0 -> PAYEE, 0 < solde < montant -> PARTIELLEMENT_PAYEE, solde >= montant -> ENVOYEE", () => {
    expect(statutDepuisSolde(0, 1000)).toBe("PAYEE");
    expect(statutDepuisSolde(-0.01, 1000)).toBe("PAYEE"); // jamais atteint en pratique (solde gardé >= 0), mais la fonction reste totale
    expect(statutDepuisSolde(400, 1000)).toBe("PARTIELLEMENT_PAYEE");
    expect(statutDepuisSolde(999.99, 1000)).toBe("PARTIELLEMENT_PAYEE");
    expect(statutDepuisSolde(1000, 1000)).toBe("ENVOYEE"); // aucun paiement encore reçu
  });

  test("statutAffiche — ECHUE uniquement pour ENVOYEE/PARTIELLEMENT_PAYEE avec échéance dépassée", () => {
    const echeancePassee = new Date("2026-01-01");
    const maintenant = new Date("2026-02-01");
    expect(statutAffiche("ENVOYEE", echeancePassee, maintenant)).toBe("ECHUE");
    expect(statutAffiche("PARTIELLEMENT_PAYEE", echeancePassee, maintenant)).toBe("ECHUE");
  });

  test("statutAffiche — jamais ECHUE pour un statut où la notion n'a pas de sens, même avec une échéance passée", () => {
    const echeancePassee = new Date("2026-01-01");
    const maintenant = new Date("2026-02-01");
    expect(statutAffiche("BROUILLON", echeancePassee, maintenant)).toBe("BROUILLON");
    expect(statutAffiche("VALIDEE", echeancePassee, maintenant)).toBe("VALIDEE");
    expect(statutAffiche("PAYEE", echeancePassee, maintenant)).toBe("PAYEE");
    expect(statutAffiche("ANNULEE", echeancePassee, maintenant)).toBe("ANNULEE");
  });

  test("statutAffiche — jamais ECHUE avant l'échéance, ni sans échéance connue", () => {
    const echeanceFuture = new Date("2026-03-01");
    const maintenant = new Date("2026-02-01");
    expect(statutAffiche("ENVOYEE", echeanceFuture, maintenant)).toBe("ENVOYEE");
    expect(statutAffiche("ENVOYEE", null, maintenant)).toBe("ENVOYEE");
  });

  test("LABEL_STATUT_FACTURE couvre les 6 statuts stockés + ECHUE (dérivé), jamais l'enum technique brut", () => {
    for (const statut of [...TOUS_STATUTS, "ECHUE"] as const) {
      expect(typeof LABEL_STATUT_FACTURE[statut]).toBe("string");
      expect(LABEL_STATUT_FACTURE[statut]).not.toBe(statut);
    }
  });
});

test.describe("V2.2-B — solde.ts : calcul du solde (arithmétique Decimal)", () => {
  test("solde = montantTTC - somme des paiements CONFIRME", () => {
    const solde = calculerSolde(new Prisma.Decimal(1000), [
      { montant: new Prisma.Decimal(300), statut: "CONFIRME" },
      { montant: new Prisma.Decimal(200), statut: "CONFIRME" },
    ]);
    expect(solde.toNumber()).toBe(500);
  });

  test("les paiements ANNULE ne réduisent jamais le solde", () => {
    const solde = calculerSolde(new Prisma.Decimal(1000), [
      { montant: new Prisma.Decimal(300), statut: "CONFIRME" },
      { montant: new Prisma.Decimal(700), statut: "ANNULE" },
    ]);
    expect(solde.toNumber()).toBe(700);
  });

  test("aucun paiement -> solde == montantTTC exactement", () => {
    const solde = calculerSolde(new Prisma.Decimal(1234.56), []);
    expect(solde.toNumber()).toBe(1234.56);
  });

  test("ne clampe jamais un résultat négatif à zéro — révèle la valeur réelle plutôt que de la masquer", () => {
    const solde = calculerSolde(new Prisma.Decimal(100), [{ montant: new Prisma.Decimal(150), statut: "CONFIRME" }]);
    expect(solde.toNumber()).toBe(-50);
    expect(soldeEstNul(solde)).toBe(true); // <= 0 compte comme "soldé", y compris un trop-perçu
  });

  test("soldeEstNul — frontière exacte à zéro, sans dérive d'arrondi binaire", () => {
    const solde = calculerSolde(new Prisma.Decimal("0.1"), [{ montant: new Prisma.Decimal("0.1"), statut: "CONFIRME" }]);
    expect(solde.toNumber()).toBe(0);
    expect(soldeEstNul(solde)).toBe(true);
  });

  test("précision Decimal — jamais l'imprécision classique de 0.1 + 0.2 en IEEE 754", () => {
    const solde = calculerSolde(new Prisma.Decimal("0.3"), [
      { montant: new Prisma.Decimal("0.1"), statut: "CONFIRME" },
      { montant: new Prisma.Decimal("0.2"), statut: "CONFIRME" },
    ]);
    expect(solde.toNumber()).toBe(0);
  });
});

test.describe("V2.2-B — montants.ts : calcul des montants de Facture", () => {
  test("jours travaillés seuls, sans heures sup, TVA 0 (franchise en base)", () => {
    const m = calculerMontantsFacture({ joursTravailles: 5, heuresSupplementaires: 0, tjmVente: 600, tauxTVA: 0 });
    expect(m).toEqual({ montantHT: 3000, montantTVA: 0, montantTTC: 3000 });
  });

  test("heures supplémentaires ajoutées au TJM horaire (tjmVente / 8)", () => {
    const m = calculerMontantsFacture({ joursTravailles: 5, heuresSupplementaires: 4, tjmVente: 800, tauxTVA: 0 });
    // 5*800 = 4000 ; 4h sup à 800/8=100/h -> 400 ; total HT = 4400
    expect(m).toEqual({ montantHT: 4400, montantTVA: 0, montantTTC: 4400 });
  });

  test("un taux de TVA non nul est appliqué au HT pour produire TTC = HT + TVA", () => {
    const m = calculerMontantsFacture({ joursTravailles: 10, heuresSupplementaires: 0, tjmVente: 500, tauxTVA: 0.2 });
    expect(m.montantHT).toBe(5000);
    expect(m.montantTVA).toBe(1000);
    expect(m.montantTTC).toBe(6000);
  });

  test("arrondi à 2 décimales — un montant stocké est toujours exactement celui affiché", () => {
    const m = calculerMontantsFacture({ joursTravailles: 3, heuresSupplementaires: 1, tjmVente: 333.33, tauxTVA: 0 });
    // Round-trip par toFixed(2) plutôt qu'un test d'entier sur montant*100
    // (lui-même sujet à l'imprécision binaire IEEE 754 qu'on cherche
    // justement à exclure du montant stocké) — un montant déjà arrondi à 2
    // décimales redonne exactement la même valeur numérique après ce
    // round-trip, quelle que soit sa forme d'affichage (zéro final ou non).
    expect(Number(m.montantHT.toFixed(2))).toBe(m.montantHT);
    expect(Number(m.montantTTC.toFixed(2))).toBe(m.montantTTC);
  });
});

test.describe("V2.2-B — regle-fiscale.ts : résolution versionnée/datée, jamais d'invention", () => {
  const FR_2024 = {
    id: "regle-fr-2024",
    juridiction: "FR",
    version: "FR_FRANCHISE_BASE_V1",
    statut: "ACTIVE",
    effectiveFrom: new Date("2024-01-01"),
    effectiveTo: null,
    source: "Code général des impôts, art. 293B",
    parametres: { tauxTVA: 0 },
  };

  test("une règle ACTIVE dont la fenêtre couvre la date est retenue", () => {
    const resolue = resoudreRegleFiscale([FR_2024], "FR", new Date("2026-01-01"));
    expect(resolue).not.toBeNull();
    expect(resolue!.version).toBe("FR_FRANCHISE_BASE_V1");
    expect(resolue!.source).toBe("Code général des impôts, art. 293B");
  });

  test("date antérieure à effectiveFrom -> UNKNOWN (null), jamais une règle appliquée rétroactivement par erreur", () => {
    expect(resoudreRegleFiscale([FR_2024], "FR", new Date("2023-12-31"))).toBeNull();
  });

  test("une règle BROUILLON ou RETIREE n'est jamais retenue, même si sa fenêtre couvre la date", () => {
    const brouillon = { ...FR_2024, id: "b", statut: "BROUILLON" };
    const retiree = { ...FR_2024, id: "r", statut: "RETIREE" };
    expect(resoudreRegleFiscale([brouillon], "FR", new Date("2026-01-01"))).toBeNull();
    expect(resoudreRegleFiscale([retiree], "FR", new Date("2026-01-01"))).toBeNull();
  });

  test("une juridiction non couverte -> UNKNOWN explicite, jamais une règle d'une autre juridiction utilisée par défaut", () => {
    expect(resoudreRegleFiscale([FR_2024], "DE", new Date("2026-01-01"))).toBeNull();
  });

  test("effectiveTo exclusif — une règle retirée à une date donnée ne couvre plus cette date exacte", () => {
    const finie = { ...FR_2024, effectiveTo: new Date("2026-06-01") };
    expect(resoudreRegleFiscale([finie], "FR", new Date("2026-05-31"))).not.toBeNull();
    expect(resoudreRegleFiscale([finie], "FR", new Date("2026-06-01"))).toBeNull();
  });

  test("une nouvelle réglementation ne doit jamais écraser silencieusement une ancienne — les deux versions restent résolvables chacune à sa date", () => {
    const ancienne = { ...FR_2024, id: "v1", version: "FR_FRANCHISE_BASE_V1", effectiveTo: new Date("2027-01-01") };
    const nouvelle = { ...FR_2024, id: "v2", version: "FR_FRANCHISE_BASE_V2", effectiveFrom: new Date("2027-01-01"), effectiveTo: null };
    const toutes = [ancienne, nouvelle];
    expect(resoudreRegleFiscale(toutes, "FR", new Date("2026-06-01"))!.version).toBe("FR_FRANCHISE_BASE_V1");
    expect(resoudreRegleFiscale(toutes, "FR", new Date("2027-06-01"))!.version).toBe("FR_FRANCHISE_BASE_V2");
  });

  test("reglesApplicables — anomalie de chevauchement : la plus récente (effectiveFrom le plus tardif) est préférée, jamais un résultat indéterminé", () => {
    const a = { ...FR_2024, id: "a", effectiveFrom: new Date("2024-01-01") };
    const b = { ...FR_2024, id: "b", effectiveFrom: new Date("2025-01-01") };
    const candidates = reglesApplicables([a, b], "FR", new Date("2026-01-01"));
    expect(candidates[0].id).toBe("b");
  });

  test("construireComplianceSnapshot — RESOLU conserve juridiction/version/source/paramètres, jamais l'id technique de la RegleFiscale", () => {
    const resolue = resoudreRegleFiscale([FR_2024], "FR", new Date("2026-01-01"))!;
    const snapshot = construireComplianceSnapshot(resolue);
    expect(snapshot).toEqual({
      statut: "RESOLU",
      juridiction: "FR",
      version: "FR_FRANCHISE_BASE_V1",
      source: "Code général des impôts, art. 293B",
      parametres: { tauxTVA: 0 },
    });
  });

  test("construireComplianceSnapshot — UNKNOWN explicite, jamais une règle juridique inventée pour combler l'absence", () => {
    const snapshot = construireComplianceSnapshot(null);
    expect(snapshot.statut).toBe("UNKNOWN");
    expect((snapshot as { raison: string }).raison).toContain("Aucune RegleFiscale ACTIVE");
  });
});

test.describe("V2.2-B — numero.ts : numérotation de Facture", () => {
  test("format FA-{mois sans tiret}-{6 premiers caractères de missionId en majuscules}", () => {
    expect(genererNumeroFacture("2026-01", "abcdef1234567890")).toBe("FA-202601-ABCDEF");
  });
});

function creerFactureDeTest(overrides: Partial<Facture> = {}): Facture & { paiements: Paiement[] } {
  return {
    id: "facture-test",
    clientId: "client-test",
    missionId: "mission-test",
    feuilleDeTempsId: "feuille-test",
    numeroFacture: "FA-202601-ABCDEF",
    statut: "ENVOYEE",
    montantHT: new Prisma.Decimal(1000),
    montantTVA: new Prisma.Decimal(0),
    montantTTC: new Prisma.Decimal(1000),
    devise: "EUR",
    dateEmission: new Date("2026-01-05"),
    // Volontairement loin dans le futur (adapterFactureClient calcule
    // statutAffiche() par rapport à la date réelle d'exécution, jamais une
    // date figée) — jamais ECHUE par accident dans ce fixture générique.
    dateEcheance: new Date("2099-01-01"),
    dateEnvoi: new Date("2026-01-05"),
    regleFiscaleId: "regle-test",
    complianceSnapshot: { statut: "RESOLU", juridiction: "FR", version: "FR_FRANCHISE_BASE_V1", source: "x", parametres: {} },
    documentId: null,
    motifAnnulation: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    paiements: [],
    ...overrides,
  } as Facture & { paiements: Paiement[] };
}

function creerPaiementDeTest(overrides: Partial<Paiement> = {}): Paiement {
  return {
    id: "paiement-test",
    factureId: "facture-test",
    montant: new Prisma.Decimal(100),
    devise: "EUR",
    datePaiement: new Date("2026-01-10"),
    reference: "REF-1",
    methode: "Virement",
    statut: "CONFIRME",
    createdAt: new Date("2026-01-10"),
    updatedAt: new Date("2026-01-10"),
    ...overrides,
  } as Paiement;
}

test.describe("V2.2-B — adapter.ts : frontière de sécurité Client-safe", () => {
  test("Sécurité — aucun champ interdit ne traverse la frontière, même injecté volontairement dans tous les champs techniques/fiscaux", () => {
    const poison = "POISON_7c4a8d09_";
    const facture = creerFactureDeTest({
      clientId: poison + "clientId",
      missionId: poison + "missionId",
      feuilleDeTempsId: poison + "feuilleDeTempsId",
      regleFiscaleId: poison + "regleFiscaleId",
      documentId: poison + "documentId",
      complianceSnapshot: { statut: "RESOLU", juridiction: poison + "juridiction", version: poison + "version", source: poison + "source", parametres: { secret: poison + "parametre" } },
    });
    const sortie = adapterFactureClient(facture);
    const serialise = JSON.stringify(sortie);

    expect(serialise).not.toContain(poison + "clientId");
    expect(serialise).not.toContain(poison + "missionId");
    expect(serialise).not.toContain(poison + "feuilleDeTempsId");
    expect(serialise).not.toContain(poison + "regleFiscaleId");
    expect(serialise).not.toContain(poison + "documentId");
    expect(serialise).not.toContain(poison + "juridiction");
    expect(serialise).not.toContain(poison + "version");
    expect(serialise).not.toContain(poison + "source");
    expect(serialise).not.toContain(poison + "parametre");

    const clesInterdites = ["clientid", "missionid", "feuilledetempsid", "regleFiscaleid".toLowerCase(), "documentid", "compliancesnapshot", "createdat", "updatedat"];
    function scannerCles(valeur: unknown, chemin: string[] = []) {
      if (valeur === null || typeof valeur !== "object") return;
      for (const [cle, sousValeur] of Object.entries(valeur as Record<string, unknown>)) {
        expect(clesInterdites, `clé interdite trouvée à ${[...chemin, cle].join(".")}`).not.toContain(cle.toLowerCase());
        scannerCles(sousValeur, [...chemin, cle]);
      }
    }
    scannerCles(sortie);
  });

  test("Allowlist — les champs autorisés (numéro, statut humain, montants, dates, solde) sont bien transmis", () => {
    const facture = creerFactureDeTest();
    const sortie = adapterFactureClient(facture);
    expect(sortie.numeroFacture).toBe("FA-202601-ABCDEF");
    expect(sortie.statut).toBe("Envoyée");
    expect(sortie.montantTTC).toBe(1000);
    expect(sortie.devise).toBe("EUR");
    expect(sortie.solde).toBe(1000);
  });

  test("motifAnnulation n'apparaît que pour une Facture ANNULEE, jamais sinon même s'il est renseigné en base", () => {
    const enCours = creerFactureDeTest({ statut: "ENVOYEE", motifAnnulation: "Ne devrait jamais apparaître" });
    expect(adapterFactureClient(enCours).motifAnnulation).toBeNull();

    const annulee = creerFactureDeTest({ statut: "ANNULEE", motifAnnulation: "Litige commercial" });
    expect(adapterFactureClient(annulee).motifAnnulation).toBe("Litige commercial");
  });

  test("le solde reflète les paiements CONFIRME liés, jamais les ANNULE", () => {
    const facture = creerFactureDeTest({
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400), statut: "CONFIRME" }), creerPaiementDeTest({ id: "p2", reference: "REF-2", montant: new Prisma.Decimal(600), statut: "ANNULE" })],
    });
    const sortie = adapterFactureClient(facture);
    expect(sortie.solde).toBe(600);
    expect(sortie.paiements).toHaveLength(1);
  });

  test("statutVariant reflète toujours le même libellé humain affiché — jamais l'enum technique brut, jamais une info supplémentaire", () => {
    expect(adapterFactureClient(creerFactureDeTest({ statut: "PAYEE" })).statutVariant).toBe("success");
    expect(adapterFactureClient(creerFactureDeTest({ statut: "BROUILLON" })).statutVariant).toBe("neutral");
  });

  test("Pureté — ne mute jamais son entrée", () => {
    const facture = creerFactureDeTest();
    const copie = JSON.parse(
      JSON.stringify(facture, (_k, v) => (v instanceof Prisma.Decimal ? v.toString() : v))
    );
    adapterFactureClient(facture);
    const apres = JSON.parse(JSON.stringify(facture, (_k, v) => (v instanceof Prisma.Decimal ? v.toString() : v)));
    expect(apres).toEqual(copie);
  });

  test("Pureté — même entrée produit toujours la même sortie (déterminisme)", () => {
    const facture = creerFactureDeTest();
    expect(adapterFactureClient(facture)).toEqual(adapterFactureClient(facture));
  });
});
