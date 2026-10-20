// SÉCURITÉ — égalisation du temps de réponse des parcours publics
// (inscription, renvoi de vérification, mot de passe oublié).
//
// Avec un fournisseur d'email réel, une adresse inscrite déclenche un appel
// réseau (Resend, plusieurs centaines de millisecondes) qu'une adresse
// inconnue ne déclenche pas : la durée de la réponse révélait l'existence du
// compte, même avec un corps de réponse identique. Toutes les réponses de
// ces parcours sont donc prolongées jusqu'à une durée plancher commune.
// Sans fournisseur (CI, poste local), aucun appel réseau : pas de plancher,
// la suite de tests n'est pas ralentie.

export const DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS = 1500;

export function dureeMinimaleReponseMs(env: Record<string, string | undefined> = process.env): number {
  return env.RESEND_API_KEY?.trim() ? DUREE_MIN_REPONSE_AVEC_FOURNISSEUR_MS : 0;
}

export async function attendreDureeMinimale(
  debut: number,
  env: Record<string, string | undefined> = process.env,
  maintenant: () => number = Date.now
): Promise<void> {
  const reste = dureeMinimaleReponseMs(env) - (maintenant() - debut);
  if (reste > 0) await new Promise((r) => setTimeout(r, reste));
}
