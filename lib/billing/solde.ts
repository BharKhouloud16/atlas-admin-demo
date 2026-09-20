import { Prisma } from "@prisma/client";

// COMPANY ATLAS — V2.2-B : Billing Foundation — calcul du solde.
//
// Fonction pure, en arithmétique Decimal (jamais number/Float) : un solde
// financier doit pouvoir être comparé à zéro sans dérive d'arrondi binaire
// (voir mandat CEO V2.2-B section 4 et 21 — "rounding", "invariants
// financiers"). Le solde n'est JAMAIS un champ stocké sur Facture : il est
// systématiquement recalculé en lisant Paiement, pour ne jamais diverger
// de la réalité (mandat CEO section 4 : "ne pas introduire une balance
// dénormalisée sans justification forte").
//
// Ne clampe jamais un résultat négatif à zéro : un solde négatif signifie
// qu'un paiement a été accepté au-delà du montant dû, ce qui ne doit
// structurellement jamais arriver (voir enregistrerPaiement,
// app/api/factures/[id]/paiements/route.ts, qui REFUSE un paiement menant
// à un solde négatif) — masquer la valeur réelle ici cacherait un bug
// plutôt que de le révéler.
export function calculerSolde(
  montantTTC: Prisma.Decimal,
  paiements: { montant: Prisma.Decimal; statut: "CONFIRME" | "ANNULE" }[]
): Prisma.Decimal {
  const totalConfirme = paiements
    .filter((p) => p.statut === "CONFIRME")
    .reduce((total, p) => total.plus(p.montant), new Prisma.Decimal(0));
  return montantTTC.minus(totalConfirme);
}

export function soldeEstNul(solde: Prisma.Decimal): boolean {
  return solde.lessThanOrEqualTo(0);
}
