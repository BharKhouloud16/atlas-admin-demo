import { Prisma } from "@prisma/client";
import type { Facture, Paiement } from "@prisma/client";
import { calculerSolde, soldeEstNul } from "./solde";
import { statutAffiche } from "./etat-facture";

// COMPANY ATLAS — V2.2-E : Billing Finalization + Financial Intelligence
// Foundation.
//
// Audit (mandat CEO V2.2-E section 1) : aucune fonction d'agrégation
// multi-Facture n'existait avant ce lot — lib/billing/solde.ts calcule le
// solde d'UNE Facture, jamais un total. Le mandat section 3/4 demande
// explicitement de "préparer les données et services" (jamais le Dashboard
// CEO lui-même, hors périmètre — section 10) : ce fichier fournit les
// fonctions pures qui rendront ce dashboard possible plus tard, sans
// construire d'UI CEO ici. Consommé pour l'instant uniquement par
// /admin/factures (mandat section 9 : "Admin doit pouvoir comprendre
// immédiatement... solde, échéances, retards, anomalies").
//
// Jamais de somme cross-devise (même invariant que
// components/client/FacturesClient.tsx et tests/api/facturation-devise.spec.ts :
// une Mission a sa propre devise, jamais convertie) — chaque agrégat est
// systématiquement groupé par devise, jamais fusionné.
//
// Les Factures ANNULEE sont exclues des totaux actifs : leur montant ne
// représente ni un encours réel ni une créance à recouvrer (voir
// lib/billing/etat-facture.ts — ANNULEE est un état terminal).

type FactureAvecPaiements = Facture & { paiements: Paiement[] };

export type RapportFinancierParDevise = {
  devise: string;
  nombreFactures: number;
  totalFacture: Prisma.Decimal; // somme des montantTTC des factures actives (hors ANNULEE)
  totalEncaisse: Prisma.Decimal; // somme des paiements CONFIRME
  totalRestant: Prisma.Decimal; // totalFacture - totalEncaisse
  totalEnRetard: Prisma.Decimal; // somme des soldes des factures ECHUE (dérivé, voir statutAffiche())
  nombreEnRetard: number;
  totalPartiellementPaye: Prisma.Decimal; // somme des soldes des factures PARTIELLEMENT_PAYEE
};

// Fonction pure, déterministe, indépendante de l'UI et de tout provider
// bancaire (mandat CEO V2.2-E section 4) : ne fait aucune requête, ne
// dépend que des données déjà chargées par l'appelant (voir
// app/admin/factures/page.tsx, qui dispose déjà de `factures` via
// GET /api/factures — aucune nouvelle route nécessaire pour cette
// fonctionnalité).
export function calculerRapportFinancier(factures: FactureAvecPaiements[], maintenant: Date = new Date()): RapportFinancierParDevise[] {
  const parDevise = new Map<string, FactureAvecPaiements[]>();
  for (const f of factures) {
    if (f.statut === "ANNULEE") continue;
    const liste = parDevise.get(f.devise) ?? [];
    liste.push(f);
    parDevise.set(f.devise, liste);
  }

  return Array.from(parDevise.entries()).map(([devise, liste]) => {
    let totalFacture = new Prisma.Decimal(0);
    let totalEncaisse = new Prisma.Decimal(0);
    let totalEnRetard = new Prisma.Decimal(0);
    let totalPartiellementPaye = new Prisma.Decimal(0);
    let nombreEnRetard = 0;

    for (const f of liste) {
      totalFacture = totalFacture.plus(f.montantTTC);
      const solde = calculerSolde(
        f.montantTTC,
        f.paiements.map((p) => ({ montant: p.montant, statut: p.statut }))
      );
      totalEncaisse = totalEncaisse.plus(f.montantTTC.minus(solde));

      if (statutAffiche(f.statut, f.dateEcheance, maintenant) === "ECHUE") {
        totalEnRetard = totalEnRetard.plus(solde);
        nombreEnRetard++;
      }
      if (f.statut === "PARTIELLEMENT_PAYEE") {
        totalPartiellementPaye = totalPartiellementPaye.plus(solde);
      }
    }

    return {
      devise,
      nombreFactures: liste.length,
      totalFacture,
      totalEncaisse,
      totalRestant: totalFacture.minus(totalEncaisse),
      totalEnRetard,
      nombreEnRetard,
      totalPartiellementPaye,
    };
  });
}

// Détection déterministe d'anomalies (mandat CEO V2.2-E section 5) —
// "Aucune IA nécessaire ici" : chaque cas est une violation d'un invariant
// déjà écrit en dur ailleurs dans ce dépôt (lib/billing/paiement.ts,
// lib/billing/transitions.ts). Ces anomalies ne devraient structurellement
// jamais se produire sur des données créées par ce code — cette fonction
// est un filet de sécurité/audit (donnée corrompue, migration future,
// intervention manuelle en base), jamais une règle métier qui déciderait
// quoi que ce soit à la place d'un humain.
export type AnomalieFacture =
  | { type: "MONTANT_TTC_NEGATIF" }
  | { type: "SOLDE_NEGATIF"; solde: number }
  | { type: "PAYEE_SOLDE_NON_NUL"; solde: number }
  | { type: "PARTIELLEMENT_PAYEE_SOLDE_NUL" }
  | { type: "PARTIELLEMENT_PAYEE_AUCUN_PAIEMENT_CONFIRME" }
  | { type: "PAIEMENT_MONTANT_NON_POSITIF"; paiementId: string }
  | { type: "PAIEMENT_DEVISE_INCOHERENTE"; paiementId: string }
  | { type: "PAIEMENT_SANS_REFERENCE"; paiementId: string }
  | { type: "PAIEMENT_REFERENCE_DUPLIQUEE"; reference: string };

export function detecterAnomalies(facture: FactureAvecPaiements): AnomalieFacture[] {
  const anomalies: AnomalieFacture[] = [];

  if (facture.montantTTC.lessThan(0)) {
    anomalies.push({ type: "MONTANT_TTC_NEGATIF" });
  }

  const solde = calculerSolde(
    facture.montantTTC,
    facture.paiements.map((p) => ({ montant: p.montant, statut: p.statut }))
  );
  if (solde.lessThan(0)) {
    anomalies.push({ type: "SOLDE_NEGATIF", solde: solde.toNumber() });
  }
  if (facture.statut === "PAYEE" && !soldeEstNul(solde)) {
    anomalies.push({ type: "PAYEE_SOLDE_NON_NUL", solde: solde.toNumber() });
  }
  if (facture.statut === "PARTIELLEMENT_PAYEE") {
    if (soldeEstNul(solde)) {
      anomalies.push({ type: "PARTIELLEMENT_PAYEE_SOLDE_NUL" });
    }
    if (solde.equals(facture.montantTTC)) {
      anomalies.push({ type: "PARTIELLEMENT_PAYEE_AUCUN_PAIEMENT_CONFIRME" });
    }
  }

  const referencesVues = new Set<string>();
  for (const p of facture.paiements) {
    if (p.montant.lessThanOrEqualTo(0)) {
      anomalies.push({ type: "PAIEMENT_MONTANT_NON_POSITIF", paiementId: p.id });
    }
    if (p.devise !== facture.devise) {
      anomalies.push({ type: "PAIEMENT_DEVISE_INCOHERENTE", paiementId: p.id });
    }
    if (!p.reference.trim()) {
      anomalies.push({ type: "PAIEMENT_SANS_REFERENCE", paiementId: p.id });
    }
    if (referencesVues.has(p.reference)) {
      anomalies.push({ type: "PAIEMENT_REFERENCE_DUPLIQUEE", reference: p.reference });
    }
    referencesVues.add(p.reference);
  }

  return anomalies;
}
