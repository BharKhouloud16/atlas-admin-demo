// COMPANY ATLAS — V2.2-B : Billing Foundation — numérotation de facture.
//
// Format FA-{mois}-{8 derniers caractères de missionId}. Jusqu'au lot CRA V1
// (25/10/2026) le suffixe reprenait les 6 PREMIERS caractères de l'id : la
// partie horodatée d'un cuid, identique pour toutes les missions créées
// dans la même fenêtre d'environ 47 s. Deux missions proches facturées le
// même mois obtenaient le même numéro, et la seconde facture échouait sur
// la contrainte @unique (Facture.numeroFacture). Les 8 derniers caractères
// sont la partie aléatoire du cuid. Les factures existantes gardent leur
// numéro (aucune donnée modifiée) ; la contrainte @unique reste le garde-fou
// final.
export function genererNumeroFacture(mois: string, missionId: string): string {
  return `FA-${mois.replace("-", "")}-${missionId.slice(-8).toUpperCase()}`;
}
