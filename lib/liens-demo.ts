// SÉCURITÉ — liens « démo » de vérification d'email et de réinitialisation
// de mot de passe.
//
// Faille corrigée : /api/auth/mot-de-passe-oublie renvoyait dans sa réponse
// HTTP un lien de réinitialisation valide pour tout compte existant. Toute
// personne connaissant une adresse email pouvait prendre le contrôle du
// compte, sans accès à la boîte mail. Le même mécanisme exposait le lien de
// vérification d'email (inscription, renvoi de vérification), et la présence
// du champ révélait l'existence du compte (énumération).
//
// Règle : ces liens ne sont JAMAIS renvoyés, sauf si les deux conditions
// suivantes sont réunies :
//   1. ATLAS_LIENS_DEMO vaut exactement « oui » (activation explicite, réservée
//      à un environnement de test contrôlé : CI sur base jetable, poste local) ;
//   2. l'application ne tourne pas sur un environnement Vercel (VERCEL_ENV
//      absent) : sur Preview comme en Production, ils restent désactivés même
//      si la variable est définie par erreur.
// La présence ou l'absence de RESEND_API_KEY n'entre PAS en compte (le
// correctif f9cd15a de la PR #54 s'y fiait : sans fournisseur d'email
// configuré, la faille restait ouverte en Preview comme en Production).

export const VARIABLE_LIENS_DEMO = "ATLAS_LIENS_DEMO";

export function liensDemoAutorises(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV) return false;
  return env[VARIABLE_LIENS_DEMO] === "oui";
}

// Ajoute le champ de lien démo à un corps de réponse uniquement si autorisé.
// Sans autorisation, le corps est renvoyé tel quel (aucune clé ajoutée, même
// vide), pour que la réponse soit identique qu'un compte existe ou non.
export function avecLienDemo<T extends Record<string, unknown>>(
  corps: T,
  champ: "lienReinitialisationDemo" | "lienVerificationDemo",
  lien: string,
  env: Record<string, string | undefined> = process.env
): T {
  return liensDemoAutorises(env) ? { ...corps, [champ]: lien } : corps;
}
