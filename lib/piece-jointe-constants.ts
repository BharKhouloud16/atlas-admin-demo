// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées. Constantes partagées
// Client/Serveur (aucune dépendance Node — importable depuis un composant
// "use client" pour une validation complémentaire côté navigateur, jamais
// en remplacement de la validation serveur de lib/piece-jointe.ts, qui
// reste la seule source de vérité).
export const MIME_AUTORISES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type MimeAutorise = (typeof MIME_AUTORISES)[number];

// 15 Mo — voir lib/piece-jointe.ts pour la justification complète.
export const TAILLE_MAX_OCTETS = 15 * 1024 * 1024;

// Affichage lisible d'une taille de fichier (Ko/Mo) — UX Client/Admin
// (Lots 5/6), jamais utilisé pour une décision de sécurité (la validation
// réelle reste en octets, côté serveur).
export function formaterTailleOctets(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}
