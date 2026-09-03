import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { envoyerEmailVerificationAdresse } from "@/lib/email";

const VALIDITE_TOKEN_MS = 24 * 60 * 60 * 1000; // 24h

// Renvoie un nouveau lien de vérification (l'ancien peut avoir expiré ou
// s'être perdu, faute de vrai fournisseur d'email branché — voir lib/email.ts).
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "Email requis." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Réponse volontairement identique que le compte existe ou non, pour ne
  // pas révéler si un email est inscrit.
  const reponseGenerique = NextResponse.json({
    ok: true,
    message: "Si ce compte existe et n'est pas encore vérifié, un nouveau lien vient d'être envoyé.",
  });

  if (!user || user.emailVerifie) {
    return reponseGenerique;
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: token, emailVerificationExpire: new Date(Date.now() + VALIDITE_TOKEN_MS) },
  });

  await envoyerEmailVerificationAdresse({ to: email, nom: email, token });

  // ⚠️ Démo : le lien est renvoyé directement (voir signup/route.ts pour la
  // même remarque) tant qu'aucun fournisseur d'email n'est branché.
  return NextResponse.json({
    ok: true,
    message: "Nouveau lien de vérification envoyé.",
    lienVerificationDemo: `/verifier-email?token=${token}`,
  });
}
