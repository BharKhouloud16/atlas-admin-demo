import crypto from "crypto";

// URLs signées à expiration pour le partage ponctuel d'un fichier privé
// (CV, vidéo de présentation) — ex. l'Admin veut envoyer le CV d'un
// ingénieur par email à un prospect qui n'a pas de compte sur la
// plateforme. Sans ce mécanisme, le seul accès possible passait par une
// session authentifiée (voir app/api/ingenieur/cv/fichier et
// .../video/fichier) : impossible à partager avec un tiers.
//
// Principe : un jeton = expiration (timestamp ms) + signature HMAC-SHA256
// de "ressource:expiration", encodés en base64url. Vérifié à temps constant
// (crypto.timingSafeEqual) pour éviter une attaque par timing sur la
// comparaison de signature. Signé avec SESSION_SECRET — même secret que les
// sessions JWT (voir lib/auth.ts), déjà présent en env et jamais commité.
const secret = process.env.SESSION_SECRET ?? "";

function signer(donnees: string): string {
  return crypto.createHmac("sha256", secret).update(donnees).digest("hex");
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
  if (!token || !secret) return false;
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
