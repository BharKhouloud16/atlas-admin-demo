// Reproduit exactement la formule de l'onglet "Profils" du fichier Excel.
// Un profil créé par auto-inscription n'a pas encore de type/montant tant
// que l'Admin ne l'a pas validé (voir /api/comptes) : on renvoie null plutôt
// que de planter, pour ne rien casser côté missions en attendant.
export function calculerTjmCout(
  type: "SALARIE" | "FREELANCE" | "PORTAGE" | null,
  montant: number | null,
  hyp: { joursAn: number; chargesSalarie: number; fraisFreelance: number }
): number | null {
  if (!type || montant == null) return null;
  if (type === "SALARIE") return (montant * (1 + hyp.chargesSalarie)) / hyp.joursAn;
  if (type === "PORTAGE") return montant;
  return montant * (1 + hyp.fraisFreelance); // FREELANCE
}
