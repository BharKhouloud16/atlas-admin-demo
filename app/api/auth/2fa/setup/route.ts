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

  // Une 2FA déjà active ne se remplace pas par cette route : sans cela, une
  // session seule (sans mot de passe ni code) écrasait le secret et
  // désactivait la protection. La désactiver d'abord exige le mot de passe
  // (voir /api/auth/2fa/desactiver). Écriture conditionnée à totpActif=false
  // pour qu'une activation concurrente ne soit jamais écrasée non plus.
  const secret = genererSecret();
  const { count } = await prisma.user.updateMany({
    where: { email: session.email, totpActif: false },
    data: { totpSecret: secret },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "La double authentification est déjà active. Désactivez-la d'abord avec votre mot de passe." },
      { status: 409 }
    );
  }

  const urlOtp = urlOtpAuth(session.email, secret);
  const qrCode = await qrCodeDataUrl(urlOtp);

  return NextResponse.json({ secret, qrCode });
}
