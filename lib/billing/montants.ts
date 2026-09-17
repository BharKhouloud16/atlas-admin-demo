// COMPANY ATLAS — V2.2-B : Billing Foundation — calcul des montants.
//
// Fonction pure : reproduit exactement la logique déjà en production dans
// lib/pdf-facture.ts (jours travaillés + heures sup, au TJM de vente de la
// Mission — jamais son TJM interne) plutôt que d'en réécrire une seconde,
// divergente. Différence volontaire : le résultat est arrondi ici à 2
// décimales avant persistance (Facture.montantHT/TVA/TTC sont des Decimal
// en base — voir prisma/schema.prisma) pour qu'un montant stocké soit
// toujours exactement celui affiché, jamais une valeur à recalculer.

export type ParametresFacturation = {
  joursTravailles: number;
  heuresSupplementaires: number;
  tjmVente: number;
  // Taux exprimé en fraction (0 = pas de TVA, franchise en base — le seul
  // régime réellement sourcé à ce stade, voir lib/billing/regle-fiscale.ts).
  tauxTVA: number;
};

export type MontantsFacture = {
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
};

function arrondir(montant: number): number {
  return Math.round(montant * 100) / 100;
}

export function calculerMontantsFacture(p: ParametresFacturation): MontantsFacture {
  const totalJours = p.joursTravailles * p.tjmVente;
  const tjmHoraire = p.tjmVente / 8;
  const totalHeuresSup = p.heuresSupplementaires * tjmHoraire;
  const montantHT = arrondir(totalJours + totalHeuresSup);
  const montantTVA = arrondir(montantHT * p.tauxTVA);
  const montantTTC = arrondir(montantHT + montantTVA);
  return { montantHT, montantTVA, montantTTC };
}
