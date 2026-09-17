import type { Facture, Paiement, Prisma } from "@prisma/client";
import { calculerSolde } from "./solde";
import { statutAffiche, LABEL_STATUT_FACTURE } from "./etat-facture";

// COMPANY ATLAS — V2.2-B : Billing Foundation — frontière de sécurité
// Client-safe.
//
// adapterFactureClient() est le SEUL point de passage autorisé entre une
// Facture persistée (qui peut porter regleFiscaleId/complianceSnapshot,
// des détails fiscaux internes) et toute donnée réellement envoyée au
// Client — même discipline que lib/client-solution/adapter.ts (V2.1) :
// construction stricte par ALLOWLIST, jamais un spread de l'entrée.
//
// Volontairement EXCLUS de la sortie (jamais lus, jamais transmis) :
// - toute donnée de Mission (margeCible, tjmVente — le Client connaît déjà
//   son propre TJM de vente, mais il le voit via montantHT/TTC de LA
//   FACTURE, jamais en le recalculant depuis Mission côté client) ;
// - regleFiscaleId / complianceSnapshot bruts (détail fiscal interne — le
//   mandat CEO section 18 est explicite : "ne pas exposer de complexité
//   fiscale inutile au client") ;
// - clientId / missionId / feuilleDeTempsId / documentId techniques (seul
//   `id` de la Facture elle-même est nécessaire au Client pour naviguer) ;
// - createdAt/updatedAt (métadonnées internes, jamais montrées).
export type PaiementClientSafe = {
  id: string;
  montant: number;
  devise: string;
  datePaiement: string;
  methode: string;
};

// Indicateur d'affichage uniquement (couleur de badge) — jamais l'enum
// technique de Facture.statut, jamais une information supplémentaire :
// simple reflet du même libellé humain, pour éviter au Client (ou à un
// composant UI) de devoir re-dériver une couleur depuis un texte français,
// ce qui serait fragile.
export type VarianteStatutFacture = "neutral" | "info" | "success" | "warning" | "error";

const VARIANTE_STATUT: Record<string, VarianteStatutFacture> = {
  "En préparation": "neutral",
  Validée: "info",
  Envoyée: "info",
  "Échéance dépassée": "error",
  "Partiellement payée": "warning",
  Payée: "success",
  Annulée: "neutral",
};

export type FactureClientSafe = {
  id: string;
  numeroFacture: string;
  statut: string; // libellé humain (LABEL_STATUT_FACTURE), jamais l'enum brut
  statutVariant: VarianteStatutFacture;
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
  devise: string;
  dateEmission: string | null;
  dateEcheance: string | null;
  solde: number;
  paiements: PaiementClientSafe[];
  motifAnnulation: string | null;
};

export function adapterFactureClient(facture: Facture & { paiements: Paiement[] }): FactureClientSafe {
  const solde = calculerSolde(
    facture.montantTTC,
    facture.paiements.map((p) => ({ montant: p.montant, statut: p.statut }))
  );
  const statutHumain = LABEL_STATUT_FACTURE[statutAffiche(facture.statut, facture.dateEcheance)];

  return {
    id: facture.id,
    numeroFacture: facture.numeroFacture,
    statut: statutHumain,
    statutVariant: VARIANTE_STATUT[statutHumain] ?? "neutral",
    montantHT: decimalVersNombre(facture.montantHT),
    montantTVA: decimalVersNombre(facture.montantTVA),
    montantTTC: decimalVersNombre(facture.montantTTC),
    devise: facture.devise,
    dateEmission: facture.dateEmission ? facture.dateEmission.toISOString() : null,
    dateEcheance: facture.dateEcheance ? facture.dateEcheance.toISOString() : null,
    solde: decimalVersNombre(solde),
    paiements: facture.paiements
      .filter((p) => p.statut === "CONFIRME")
      .map((p) => ({
        id: p.id,
        montant: decimalVersNombre(p.montant),
        devise: p.devise,
        datePaiement: p.datePaiement.toISOString(),
        methode: p.methode,
      })),
    motifAnnulation: facture.statut === "ANNULEE" ? facture.motifAnnulation : null,
  };
}

function decimalVersNombre(valeur: Prisma.Decimal): number {
  return valeur.toNumber();
}
