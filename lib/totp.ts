import { authenticator } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";

// Authentification à deux facteurs (TOTP, façon Google Authenticator) —
// réservée au rôle ADMIN (voir prisma/schema.prisma, User.totpSecret /
// totpActif / totpCodesSecours), le compte le plus sensible de la
// plateforme (coûts/marges internes, validation des inscriptions).
authenticator.options = { window: 1 }; // tolère un décalage d'horloge de ±30s

const EMETTEUR = "Atlas Quality Partners";

export function genererSecret(): string {
  return authenticator.generateSecret();
}

export function urlOtpAuth(email: string, secret: string): string {
  return authenticator.keyuri(email, EMETTEUR, secret);
}

export async function qrCodeDataUrl(urlOtp: string): Promise<string> {
  return QRCode.toDataURL(urlOtp);
}

export function verifierCode(code: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

// Codes de secours à usage unique (si le téléphone est perdu) — générés une
// seule fois à l'activation, affichés une seule fois en clair à l'Admin,
// puis stockés hashés (jamais en clair en base, comme un mot de passe).
export function genererCodesSecours(nombre = 8): string[] {
  return Array.from({ length: nombre }, () => crypto.randomBytes(5).toString("hex"));
}
