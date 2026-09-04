import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { genererSecret, urlOtpAuth, qrCodeDataUrl } from "@/lib/totp";

// Étape 1 de l'activation du 2FA : génère un nouveau secret TOTP (pas
// encore actif — totpActif reste false tant que POST /verifier n'a pas
// confirmé un code valide, voir cette route) et son QR code à scanner dans
// une app d'authentification (Google Authenticator, Authy...). Réservé à
// l'Admin, sur son propre compte uniquement.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const secret = genererSecret();
  await prisma.user.update({ where: { email: session.email }, data: { totpSecret: secret, totpActif: false } });

  const urlOtp = urlOtpAuth(session.email, secret);
  const qrCode = await qrCodeDataUrl(urlOtp);

  return NextResponse.json({ secret, qrCode });
}
