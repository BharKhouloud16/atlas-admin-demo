// Renvoi du lien de vérification d'email : délai minimal par compte (voir
// app/api/auth/renvoyer-verification/route.ts). Hors du fichier route.ts :
// Next.js n'autorise que les exports de route (GET, POST…) dans ce fichier.

export const VALIDITE_TOKEN_VERIFICATION_MS = 24 * 60 * 60 * 1000; // 24h

// Un nouveau lien n'est ni généré ni envoyé si le précédent a moins de
// 2 minutes : évite d'inonder une boîte mail et d'invalider en boucle le lien
// que la personne vient de recevoir.
export const DELAI_MIN_RENVOI_MS = 2 * 60 * 1000;

// La date d'émission du dernier lien se déduit de son expiration
// (émission + 24h) : aucune nouvelle colonne, aucune migration.
export function renvoiTropRecent(expiration: Date | null | undefined, maintenant = Date.now()): boolean {
  if (!expiration) return false;
  const emission = expiration.getTime() - VALIDITE_TOKEN_VERIFICATION_MS;
  return maintenant - emission < DELAI_MIN_RENVOI_MS;
}

// Seuil équivalent, utilisable dans une mise à jour conditionnelle en base :
// un nouveau lien n'est autorisé que si l'expiration actuelle est absente ou
// <= ce seuil (c.-à-d. émis il y a au moins DELAI_MIN_RENVOI_MS). La
// condition est évaluée par PostgreSQL au moment de l'écriture : deux
// requêtes simultanées ne peuvent pas toutes deux régénérer et envoyer un lien.
export function seuilExpirationRenvoi(maintenant = Date.now()): Date {
  return new Date(maintenant + VALIDITE_TOKEN_VERIFICATION_MS - DELAI_MIN_RENVOI_MS);
}
