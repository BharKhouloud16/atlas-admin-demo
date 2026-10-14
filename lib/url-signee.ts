import crypto from "crypto";
import { secretCourant } from "@/lib/session-secret";

// URLs signées à expiration pour le partage ponctuel d'un fichier privé
// (CV, vidéo de présentation) — ex. l'Admin veut envoyer le CV d'un
// ingénieur par email à un prospect qui n'a pas de compte sur la
// plateforme. Sans ce mécanisme, le seul accès possible passait par une
// session authentifiée (voir app/api/ingenieur/cv/fichier) : impossible à
// partager avec un tiers.
//
// Principe : un jeton = expiration (timestamp ms) + signature HMAC-SHA256
// de "ressource:expiration", encodés en base64url. Vérifié à temps constant
// (crypto.timingSafeEqual) pour éviter une attaque par timing sur la
// comparaison de signature.
//
// LOT 12.2 — SECURITY HARDENING : réutilise secretCourant (lib/session-
// secret.ts), déjà validé par le garde centralisé exigerSecret() — plus
// aucune lecture indépendante de process.env.SESSION_SECRET ici, plus aucun
// fallback "" possible. Le chargement de ce module échoue désormais avec le
// reste de l'application si SESSION_SECRET est absent/vide/whitespace,
// avant même qu'un token ait pu être généré ou vérifié (cohérent avec
// lib/auth.ts et middleware.ts).
//
// Rotation (SESSION_SECRET_PREVIOUS, voir lib/session-secret.ts) : les URLs
// signées n'utilisent QUE secretCourant, jamais secretsVerification (la
// liste incluant l'ancien secret) — un lien créé avant une rotation de
// SESSION_SECRET cesse de vérifier immédiatement après, sans fenêtre de
// grâce (contrairement aux sessions JWT). Constat volontairement non traité
// dans ce lot : élargir ce mécanisme à la rotation n'a pas été demandé.
function signer(donnees: string): string {
  return crypto.createHmac("sha256", secretCourant).update(donnees).digest("hex");
}

const DUREE_PAR_DEFAUT_SEC = 24 * 60 * 60; // 24h

export function creerUrlSignee(ressource: string, dureeSec: number = DUREE_PAR_DEFAUT_SEC): { token: string; expire: number } {
  const expire = Date.now() + dureeSec * 1000;
  const donnees = `${ressource}:${expire}`;
  const signature = signer(donnees);
  const token = Buffer.from(`${expire}.${signature}`, "utf-8").toString("base64url");
  return { token, expire };
}

export function verifierUrlSignee(ressource: string, token: string | null): boolean {
  // secretCourant est garanti non vide : lib/session-secret.ts fait déjà
  // échouer le chargement de tout module qui l'importe si SESSION_SECRET
  // est absent/vide/whitespace — aucun garde supplémentaire nécessaire ici.
  if (!token) return false;
  try {
    const decode = Buffer.from(token, "base64url").toString("utf-8");
    const separateur = decode.indexOf(".");
    if (separateur < 0) return false;
    const expireStr = decode.slice(0, separateur);
    const signature = decode.slice(separateur + 1);
    const expire = Number(expireStr);
    if (!expire || Date.now() > expire) return false;

    const attendu = signer(`${ressource}:${expire}`);
    const bufA = Buffer.from(signature, "hex");
    const bufB = Buffer.from(attendu, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
