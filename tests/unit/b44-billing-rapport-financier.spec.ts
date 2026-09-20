import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import type { Facture, Paiement } from "@prisma/client";
import { calculerRapportFinancier, detecterAnomalies } from "@/lib/billing/rapport-financier";

// COMPANY ATLAS — V2.2-E (20/09/2026) : tests des fonctions pures de la
// Financial Intelligence Foundation (lib/billing/rapport-financier.ts).
// Aucune DB, aucun HTTP — même découpage que
// tests/unit/b42-billing-pure.spec.ts (V2.2-B). Ces fonctions sont
// consommées uniquement par le GET /api/factures existant (Admin), jamais
// une nouvelle route (voir app/api/factures/route.ts) — aucun test API
// séparé n'est donc nécessaire : le comportement de bout en bout est déjà
// couvert par le fait que ce GET reste testé ailleurs (b42/c47/b43).

function creerFactureDeTest(overrides: Partial<Facture & { paiements: Paiement[] }> = {}): Facture & { paiements: Paiement[] } {
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
    dateEcheance: new Date("2099-01-01"),
    dateEnvoi: new Date("2026-01-05"),
    regleFiscaleId: "regle-test",
    complianceSnapshot: { statut: "RESOLU", juridiction: "FR", version: "x", source: "x", parametres: {} },
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

test.describe("V2.2-E — calculerRapportFinancier() : agrégats multi-Facture", () => {
  test("aucune Facture -> tableau vide, jamais une erreur", () => {
    expect(calculerRapportFinancier([])).toEqual([]);
  });

  test("une seule Facture ENVOYEE sans paiement -> totalFacture = totalRestant, totalEncaisse = 0", () => {
    const rapport = calculerRapportFinancier([creerFactureDeTest({ montantTTC: new Prisma.Decimal(1000) })]);
    expect(rapport).toHaveLength(1);
    expect(rapport[0].devise).toBe("EUR");
    expect(rapport[0].totalFacture.toNumber()).toBe(1000);
    expect(rapport[0].totalEncaisse.toNumber()).toBe(0);
    expect(rapport[0].totalRestant.toNumber()).toBe(1000);
    expect(rapport[0].nombreFactures).toBe(1);
  });

  test("un paiement CONFIRME réduit totalRestant et augmente totalEncaisse d'exactement son montant", () => {
    const facture = creerFactureDeTest({
      montantTTC: new Prisma.Decimal(1000),
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400) })],
    });
    const rapport = calculerRapportFinancier([facture]);
    expect(rapport[0].totalEncaisse.toNumber()).toBe(400);
    expect(rapport[0].totalRestant.toNumber()).toBe(600);
  });

  test("un paiement ANNULE n'est jamais compté dans totalEncaisse", () => {
    const facture = creerFactureDeTest({
      montantTTC: new Prisma.Decimal(1000),
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400), statut: "ANNULE" })],
    });
    const rapport = calculerRapportFinancier([facture]);
    expect(rapport[0].totalEncaisse.toNumber()).toBe(0);
    expect(rapport[0].totalRestant.toNumber()).toBe(1000);
  });

  test("une Facture ANNULEE est totalement exclue des totaux actifs", () => {
    const facture = creerFactureDeTest({ statut: "ANNULEE", montantTTC: new Prisma.Decimal(5000) });
    const rapport = calculerRapportFinancier([facture]);
    expect(rapport).toEqual([]);
  });

  test("jamais de somme cross-devise — deux devises produisent deux entrées distinctes, jamais fusionnées", () => {
    const eur = creerFactureDeTest({ id: "f-eur", devise: "EUR", montantTTC: new Prisma.Decimal(1000) });
    const usd = creerFactureDeTest({ id: "f-usd", devise: "USD", montantTTC: new Prisma.Decimal(2000) });
    const rapport = calculerRapportFinancier([eur, usd]);
    expect(rapport).toHaveLength(2);
    const parDevise = Object.fromEntries(rapport.map((r) => [r.devise, r]));
    expect(parDevise.EUR.totalFacture.toNumber()).toBe(1000);
    expect(parDevise.USD.totalFacture.toNumber()).toBe(2000);
  });

  test("une Facture ECHUE contribue à totalEnRetard (montant = son solde, pas son montantTTC entier si déjà partiellement payée)", () => {
    const facture = creerFactureDeTest({
      montantTTC: new Prisma.Decimal(1000),
      dateEcheance: new Date("2020-01-01"), // passée
      statut: "PARTIELLEMENT_PAYEE",
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(300) })],
    });
    const rapport = calculerRapportFinancier([facture], new Date("2026-01-01"));
    expect(rapport[0].totalEnRetard.toNumber()).toBe(700);
    expect(rapport[0].nombreEnRetard).toBe(1);
    expect(rapport[0].totalPartiellementPaye.toNumber()).toBe(700);
  });

  test("une Facture PARTIELLEMENT_PAYEE mais pas encore échue contribue à totalPartiellementPaye, jamais à totalEnRetard", () => {
    const facture = creerFactureDeTest({
      montantTTC: new Prisma.Decimal(1000),
      dateEcheance: new Date("2099-01-01"),
      statut: "PARTIELLEMENT_PAYEE",
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(300) })],
    });
    const rapport = calculerRapportFinancier([facture], new Date("2026-01-01"));
    expect(rapport[0].totalPartiellementPaye.toNumber()).toBe(700);
    expect(rapport[0].totalEnRetard.toNumber()).toBe(0);
    expect(rapport[0].nombreEnRetard).toBe(0);
  });

  test("déterminisme — même entrée produit toujours le même résultat", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest()] });
    const r1 = calculerRapportFinancier([facture], new Date("2026-06-01"));
    const r2 = calculerRapportFinancier([facture], new Date("2026-06-01"));
    expect(r1).toEqual(r2);
  });

  test("Pureté — ne mute jamais son entrée", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest()] });
    const paiementsAvant = [...facture.paiements];
    calculerRapportFinancier([facture]);
    expect(facture.paiements).toEqual(paiementsAvant);
    expect(facture.montantTTC.toNumber()).toBe(1000);
  });
});

test.describe("V2.2-E — detecterAnomalies() : premier niveau de détection déterministe", () => {
  test("Facture cohérente (ENVOYEE, aucun paiement) -> aucune anomalie", () => {
    expect(detecterAnomalies(creerFactureDeTest())).toEqual([]);
  });

  test("Facture cohérente PAYEE (solde exactement nul) -> aucune anomalie", () => {
    const facture = creerFactureDeTest({ statut: "PAYEE", montantTTC: new Prisma.Decimal(1000), paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(1000) })] });
    expect(detecterAnomalies(facture)).toEqual([]);
  });

  test("Facture cohérente PARTIELLEMENT_PAYEE (0 < payé < TTC) -> aucune anomalie", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE", montantTTC: new Prisma.Decimal(1000), paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400) })] });
    expect(detecterAnomalies(facture)).toEqual([]);
  });

  test("montantTTC négatif -> MONTANT_TTC_NEGATIF", () => {
    const facture = creerFactureDeTest({ montantTTC: new Prisma.Decimal(-100) });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("MONTANT_TTC_NEGATIF");
  });

  test("solde négatif (trop perçu, ne devrait structurellement jamais arriver) -> SOLDE_NEGATIF", () => {
    // Construit délibérément un état incohérent — impossible à produire via
    // l'API réelle (enregistrerPaiement le refuse), simulé ici pour vérifier
    // que le détecteur révèle bien l'anomalie plutôt que de la masquer.
    const facture = creerFactureDeTest({ montantTTC: new Prisma.Decimal(1000), paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(1200) })] });
    const anomalies = detecterAnomalies(facture);
    expect(anomalies.some((a) => a.type === "SOLDE_NEGATIF" && "solde" in a && a.solde === -200)).toBe(true);
  });

  test("statut PAYEE avec solde non nul -> PAYEE_SOLDE_NON_NUL", () => {
    const facture = creerFactureDeTest({ statut: "PAYEE", montantTTC: new Prisma.Decimal(1000), paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400) })] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PAYEE_SOLDE_NON_NUL");
  });

  test("statut PARTIELLEMENT_PAYEE avec solde nul -> PARTIELLEMENT_PAYEE_SOLDE_NUL", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE", montantTTC: new Prisma.Decimal(1000), paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(1000) })] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PARTIELLEMENT_PAYEE_SOLDE_NUL");
  });

  test("statut PARTIELLEMENT_PAYEE sans aucun paiement confirmé (solde == TTC) -> PARTIELLEMENT_PAYEE_AUCUN_PAIEMENT_CONFIRME", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE", montantTTC: new Prisma.Decimal(1000), paiements: [] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PARTIELLEMENT_PAYEE_AUCUN_PAIEMENT_CONFIRME");
  });

  test("paiement à montant non positif -> PAIEMENT_MONTANT_NON_POSITIF", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(0) })] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PAIEMENT_MONTANT_NON_POSITIF");
  });

  test("paiement en devise différente de la Facture -> PAIEMENT_DEVISE_INCOHERENTE", () => {
    const facture = creerFactureDeTest({ devise: "EUR", paiements: [creerPaiementDeTest({ devise: "USD" })] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PAIEMENT_DEVISE_INCOHERENTE");
  });

  test("paiement sans référence (chaîne vide ou blanche) -> PAIEMENT_SANS_REFERENCE", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest({ reference: "   " })] });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PAIEMENT_SANS_REFERENCE");
  });

  test("deux paiements avec la même référence sur la même Facture -> PAIEMENT_REFERENCE_DUPLIQUEE", () => {
    const facture = creerFactureDeTest({
      paiements: [creerPaiementDeTest({ id: "p1", reference: "REF-X" }), creerPaiementDeTest({ id: "p2", reference: "REF-X" })],
    });
    expect(detecterAnomalies(facture).map((a) => a.type)).toContain("PAIEMENT_REFERENCE_DUPLIQUEE");
  });

  test("plusieurs anomalies simultanées sont toutes rapportées, jamais seulement la première", () => {
    const facture = creerFactureDeTest({
      statut: "PAYEE",
      montantTTC: new Prisma.Decimal(1000),
      paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400), reference: "" })],
    });
    const types = detecterAnomalies(facture).map((a) => a.type);
    expect(types).toContain("PAYEE_SOLDE_NON_NUL");
    expect(types).toContain("PAIEMENT_SANS_REFERENCE");
  });

  test("Pureté — ne mute jamais son entrée", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest()] });
    const copiePaiements = [...facture.paiements];
    detecterAnomalies(facture);
    expect(facture.paiements).toEqual(copiePaiements);
  });

  test("déterminisme — même entrée produit toujours la même sortie", () => {
    const facture = creerFactureDeTest({ statut: "PAYEE", paiements: [creerPaiementDeTest({ montant: new Prisma.Decimal(400) })] });
    expect(detecterAnomalies(facture)).toEqual(detecterAnomalies(facture));
  });
});
