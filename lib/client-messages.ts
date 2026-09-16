// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Fonction PURE (aucun accès Prisma) : valide le contenu d'un message
// avant écriture — jamais un texte vide, jamais un texte inventé, jamais
// une taille illimitée (protection basique contre l'abus). Réutilisée à
// l'identique côté CLIENT et côté ADMIN (même route conceptuelle, deux
// points d'entrée — voir app/api/client/messages et
// app/api/clients/[id]/messages).

export const CONTENU_MESSAGE_MAX = 2000;

export function validerContenuMessage(contenu: unknown): string | null {
  if (typeof contenu !== "string") return null;
  const nettoye = contenu.trim();
  if (nettoye.length === 0 || nettoye.length > CONTENU_MESSAGE_MAX) return null;
  return nettoye;
}
