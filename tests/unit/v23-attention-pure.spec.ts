import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import type { Facture, Paiement, ClientNeed } from "@prisma/client";
import {
  genererCandidatsFacture,
  genererCandidatAnomalie,
  genererCandidatBesoin,
  comparerAttentions,
} from "@/lib/attention/generateurs";

// COMPANY ATLAS — V2.3 (20/09/2026) : tests des fonctions pures de
// Communication Intelligence + Attention Center
// (lib/attention/generateurs.ts). Aucune DB, aucun HTTP — même découpage
// que tests/unit/b44-billing-rapport-financier.spec.ts (V2.2-E).

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
    complianceSnapshot: null,
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

function creerBesoinDeTest(overrides: Partial<ClientNeed> = {}): ClientNeed {
  return {
    id: "besoin-test",
    clientId: "client-test",
    correlationId: "corr-test",
    texteOriginal: "Nous cherchons un développeur.",
    titre: "Développeur",
    statut: "SOUMIS",
    coherenceStatut: "UNKNOWN",
    coherenceDetail: null,
    analyseProvider: null,
    analyseeLe: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as ClientNeed;
}

const MAINTENANT = new Date("2026-06-15T12:00:00Z");

test.describe("V2.3 — genererCandidatsFacture() : cycle de vie Billing -> Attention", () => {
  test("Facture ENVOYEE, échéance lointaine, sans paiement -> uniquement FACTURE_ENVOYEE", () => {
    const facture = creerFactureDeTest({ dateEcheance: new Date("2099-01-01") });
    const candidats = genererCandidatsFacture(facture, MAINTENANT);
    expect(candidats.map((c) => c.type)).toEqual(["FACTURE_ENVOYEE"]);
    expect(candidats[0].recipientType).toBe("CLIENT");
    expect(candidats[0].recipientId).toBe("client-test");
  });

  test("échéance dans 3 jours -> FACTURE_ECHEANCE_PROCHE présent, jamais FACTURE_ECHUE", () => {
    const dansTroisJours = new Date(MAINTENANT.getTime() + 3 * 24 * 60 * 60 * 1000);
    const facture = creerFactureDeTest({ dateEcheance: dansTroisJours });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).toContain("FACTURE_ECHEANCE_PROCHE");
    expect(types).not.toContain("FACTURE_ECHUE");
  });

  test("échéance dans 10 jours (hors fenêtre de 7 jours) -> ni ECHEANCE_PROCHE ni ECHUE", () => {
    const dansDixJours = new Date(MAINTENANT.getTime() + 10 * 24 * 60 * 60 * 1000);
    const facture = creerFactureDeTest({ dateEcheance: dansDixJours });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).not.toContain("FACTURE_ECHEANCE_PROCHE");
    expect(types).not.toContain("FACTURE_ECHUE");
  });

  test("échéance dépassée -> FACTURE_ECHUE présent, jamais FACTURE_ECHEANCE_PROCHE (mutuellement exclusifs)", () => {
    const hier = new Date(MAINTENANT.getTime() - 24 * 60 * 60 * 1000);
    const facture = creerFactureDeTest({ dateEcheance: hier });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).toContain("FACTURE_ECHUE");
    expect(types).not.toContain("FACTURE_ECHEANCE_PROCHE");
  });

  test("Facture PARTIELLEMENT_PAYEE -> PAIEMENT_PARTIEL, catégorie INFORMATION (mandat : jamais une alerte pour un paiement partiel)", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE" });
    const candidat = genererCandidatsFacture(facture, MAINTENANT).find((c) => c.type === "PAIEMENT_PARTIEL");
    expect(candidat).toBeTruthy();
    expect(candidat!.categorie).toBe("INFORMATION");
    expect(candidat!.resume).toContain("Solde restant");
  });

  test("Facture PAYEE -> PAIEMENT_RECU présent, PAIEMENT_PARTIEL absent", () => {
    const facture = creerFactureDeTest({ statut: "PAYEE" });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).toContain("PAIEMENT_RECU");
    expect(types).not.toContain("PAIEMENT_PARTIEL");
  });

  test("un paiement ANNULE sur une Facture non-ANNULEE -> PAIEMENT_ANNULE présent", () => {
    const facture = creerFactureDeTest({ statut: "ENVOYEE", paiements: [creerPaiementDeTest({ statut: "ANNULE" })] });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).toContain("PAIEMENT_ANNULE");
  });

  test("aucun paiement ANNULE -> jamais de PAIEMENT_ANNULE (pas un état par défaut)", () => {
    const facture = creerFactureDeTest({ paiements: [creerPaiementDeTest({ statut: "CONFIRME" })] });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).not.toContain("PAIEMENT_ANNULE");
  });

  test("Facture ANNULEE -> jamais FACTURE_ENVOYEE ni PAIEMENT_ANNULE (état terminal, plus rien à signaler)", () => {
    const facture = creerFactureDeTest({ statut: "ANNULEE", paiements: [creerPaiementDeTest({ statut: "ANNULE" })] });
    const types = genererCandidatsFacture(facture, MAINTENANT).map((c) => c.type);
    expect(types).not.toContain("FACTURE_ENVOYEE");
    expect(types).not.toContain("PAIEMENT_ANNULE");
  });

  test("déterminisme : deux appels avec les mêmes entrées produisent exactement le même résultat", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE", paiements: [creerPaiementDeTest()] });
    const a = genererCandidatsFacture(facture, MAINTENANT);
    const b = genererCandidatsFacture(facture, MAINTENANT);
    expect(a).toEqual(b);
  });

  test("pureté : la Facture passée en entrée n'est jamais mutée", () => {
    const facture = creerFactureDeTest({ statut: "PARTIELLEMENT_PAYEE" });
    const copie = JSON.parse(JSON.stringify(facture, (_k, v) => (v instanceof Prisma.Decimal ? v.toString() : v)));
    genererCandidatsFacture(facture, MAINTENANT);
    const apres = JSON.parse(JSON.stringify(facture, (_k, v) => (v instanceof Prisma.Decimal ? v.toString() : v)));
    expect(apres).toEqual(copie);
  });
});

test.describe("V2.3 — genererCandidatAnomalie() : Admin uniquement (jamais Client)", () => {
  test("aucune anomalie -> null", () => {
    expect(genererCandidatAnomalie(creerFactureDeTest())).toBeNull();
  });

  test("une anomalie détectée -> candidat ADMIN, jamais CLIENT, priorité critique", () => {
    const facture = creerFactureDeTest({ montantTTC: new Prisma.Decimal(-1) });
    const candidat = genererCandidatAnomalie(facture);
    expect(candidat).toBeTruthy();
    expect(candidat!.recipientType).toBe("ADMIN");
    expect(candidat!.recipientId).toBeNull();
    expect(candidat!.categorie).toBe("ALERTE");
    expect(candidat!.priorite).toBe("P0_CRITIQUE");
    expect(candidat!.type).toBe("ANOMALIE_FINANCIERE");
  });
});

test.describe("V2.3 — genererCandidatBesoin() : 2e domaine, prouve le modèle générique", () => {
  test("statut différent de A_CLARIFIER -> null", () => {
    expect(genererCandidatBesoin(creerBesoinDeTest({ statut: "SOUMIS" }))).toBeNull();
    expect(genererCandidatBesoin(creerBesoinDeTest({ statut: "VALIDE" }))).toBeNull();
  });

  test("statut A_CLARIFIER -> candidat CLIENT, catégorie ACTION_REQUISE", () => {
    const besoin = creerBesoinDeTest({ statut: "A_CLARIFIER", clientId: "client-xyz" });
    const candidat = genererCandidatBesoin(besoin);
    expect(candidat).toBeTruthy();
    expect(candidat!.recipientType).toBe("CLIENT");
    expect(candidat!.recipientId).toBe("client-xyz");
    expect(candidat!.categorie).toBe("ACTION_REQUISE");
    expect(candidat!.type).toBe("BESOIN_A_CLARIFIER");
  });
});

test.describe("V2.3 — comparerAttentions() : ordre d'affichage (mandat section 18)", () => {
  function item(categorie: "ACTION_REQUISE" | "ALERTE" | "INFORMATION" | "RECOMMANDATION", priorite: "P0_CRITIQUE" | "P1_HAUTE" | "P2_NORMALE" | "P3_BASSE", createdAt: string) {
    return { categorie, priorite, createdAt: new Date(createdAt) };
  }

  test("ACTION_REQUISE passe toujours avant ALERTE, même avec une priorité plus basse", () => {
    const actionBasse = item("ACTION_REQUISE", "P3_BASSE", "2026-01-01");
    const alerteCritique = item("ALERTE", "P0_CRITIQUE", "2026-01-01");
    expect(comparerAttentions(actionBasse, alerteCritique)).toBeLessThan(0);
  });

  test("à catégorie égale, P0_CRITIQUE passe avant P3_BASSE", () => {
    const p0 = item("ALERTE", "P0_CRITIQUE", "2026-01-01");
    const p3 = item("ALERTE", "P3_BASSE", "2026-01-01");
    expect(comparerAttentions(p0, p3)).toBeLessThan(0);
  });

  test("à catégorie et priorité égales, le plus récent passe en premier", () => {
    const recent = item("ALERTE", "P1_HAUTE", "2026-06-01");
    const ancien = item("ALERTE", "P1_HAUTE", "2026-01-01");
    expect(comparerAttentions(recent, ancien)).toBeLessThan(0);
  });

  test("tri complet d'une liste mélangée respecte catégorie > priorité > date", () => {
    const liste = [
      item("RECOMMANDATION", "P0_CRITIQUE", "2026-01-01"),
      item("ACTION_REQUISE", "P3_BASSE", "2026-01-01"),
      item("ALERTE", "P1_HAUTE", "2026-01-01"),
      item("ACTION_REQUISE", "P1_HAUTE", "2026-01-01"),
    ];
    const triee = [...liste].sort(comparerAttentions);
    expect(triee.map((i) => i.categorie)).toEqual(["ACTION_REQUISE", "ACTION_REQUISE", "ALERTE", "RECOMMANDATION"]);
    expect(triee[0].priorite).toBe("P1_HAUTE"); // parmi les 2 ACTION_REQUISE, P1 avant P3
  });
});
