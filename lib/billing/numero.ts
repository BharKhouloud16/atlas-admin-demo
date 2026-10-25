// COMPANY ATLAS — numérotation des factures (lot CRA V1, 25/10/2026).
//
// Numérotation réglementaire : chronologique et continue, attribuée à
// l'ÉMISSION (validation BROUILLON -> VALIDEE, voir lib/billing/transitions.ts)
// à partir d'un compteur annuel en base (CompteurFacture), incrémenté dans la
// même transaction que la validation : une validation refusée ou concurrente
// perdante n'avance jamais le compteur, donc aucun trou ni doublon.
//
// Un brouillon n'est pas une facture émise : il porte un numéro provisoire
// unique (une facture par feuille de temps), remplacé à la validation.
//
// Avant ce lot, le numéro était FA-{AAAAMM}-{6 premiers caractères de
// missionId}, attribué dès la création : non séquentiel, et en collision
// pour deux missions créées dans la même fenêtre d'environ 47 s (partie
// horodatée du cuid). Les factures déjà numérotées ainsi — y compris les
// brouillons — gardent leur numéro : seule une facture au numéro provisoire
// reçoit un numéro de la séquence.
const PREFIXE_PROVISOIRE = "BROUILLON-";

export function numeroProvisoire(feuilleDeTempsId: string): string {
  return `${PREFIXE_PROVISOIRE}${feuilleDeTempsId}`;
}

export function estNumeroProvisoire(numero: string): boolean {
  return numero.startsWith(PREFIXE_PROVISOIRE);
}

export function numeroReglementaire(annee: number, sequence: number): string {
  return `FA-${annee}-${String(sequence).padStart(5, "0")}`;
}

// Année d'émission selon le calendrier français (une facture validée le
// 31/12 à 23h30 heure de Paris appartient à cette année-là, pas à l'année
// UTC suivante).
export function anneeEmission(date: Date): number {
  return Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(date));
}
