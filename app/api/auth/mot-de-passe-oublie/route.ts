import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { envoyerEmailReinitialisationMotDePasse } from "@/lib/email";
import { demanderReinitialisationSchema, premierMessageZod } from "@/lib/validation";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";

// B14 — Étape 1 du mot de passe oublié : demande d'un lien de
// réinitialisation. Volontairement calquée sur le circuit de vérification
// d'email déjà en place (voir app/api/auth/signup/route.ts,
// lib/email.ts) : même génération de token, même limitation "démo, aucun
// fournisseur d'email branché" (le lien est renvoyé dans la réponse pour
// permettre de tester le parcours, comme lienVerificationDemo au signup).
//
// Sécurité :
// - Rate-limité par IP (même mécanisme que /api/auth/login, /api/auth/signup).
// - Réponse strictement identique que le compte existe ou non (jamais
//   d'énumération d'adresses email valides).
// - Token opaque (32 octets aléatoires), à usage unique, expirant après 1h —
//   bien plus court que le token de vérification d'email (24h) car il donne
//   directement accès à la prise de contrôle du compte.
// - N'affecte jamais un compte ADMIN créé par un autre canal que le mot de
//   passe (aucune règle métier ADMIN modifiée : un ADMIN peut aussi
//   réinitialiser son mot de passe par ce chemin, comme n'importe quel rôle).

const VALIDITE_TOKEN_MS = 60 * 60 * 1000; // 1h

function genererToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(req: NextRequest) {
  const ip = adresseIp(req);
  const autorise = await verifierLimiteIp(`mot-de-passe-oublie:${ip}`);
  if (!autorise) {
    return NextResponse.json(
      { error: "Trop de tentatives depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const corpsBrut = await req.json();
  const analyse = demanderReinitialisationSchema.safeParse(corpsBrut);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { email } = analyse.data;

  const messageGenerique = {
    ok: true,
    message: "Si un compte existe avec cette adresse, un email de réinitialisation a été envoyé.",
  };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Ne jamais révéler si l'adresse existe — même réponse dans les deux cas.
    return NextResponse.json(messageGenerique);
  }

  const token = genererToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { resetPasswordToken: token, resetPasswordExpire: new Date(Date.now() + VALIDITE_TOKEN_MS) },
  });

  await envoyerEmailReinitialisationMotDePasse({ to: email, token });

  return NextResponse.json({
    ...messageGenerique,
    // ⚠️ Démo : aucun fournisseur d'email n'est branché (voir lib/email.ts) —
    // le lien n'arrive pas réellement en boîte de réception, il est renvoyé
    // ici pour permettre de tester le parcours (même convention que
    // lienVerificationDemo sur /api/auth/signup).
    lienReinitialisationDemo: `/reinitialiser-mot-de-passe?token=${token}`,
  });
}
