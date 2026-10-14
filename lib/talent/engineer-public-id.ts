// ATLAS LOT 15.5 — identifiant public stable d'un ingénieur, montré au
// Client à la place de son identité réelle (nom/prénom/email/téléphone).
// Dérivation déterministe par HMAC-SHA256 (même clé que le reste de
// l'authentification, voir lib/session-secret.ts — aucun nouveau secret
// créé) : le même profilId produit toujours le même identifiant, et
// l'opération n'est pas inversible sans connaître SESSION_SECRET (jamais
// exposé côté client).
import crypto from "crypto";
import { secretCourant } from "@/lib/session-secret";

export function idPublicIngenieur(profilId: string): string {
  const hash = crypto.createHmac("sha256", secretCourant).update(profilId).digest("hex");
  return `ENG-${hash.slice(0, 6).toUpperCase()}`;
}
