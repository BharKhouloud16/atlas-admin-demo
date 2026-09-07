import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { reinitialiserMotDePasseSchema, premierMessageZod } from "@/lib/validation";
import { validerMotDePasse } from "@/lib/password-policy";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";

// B14 — Étape 2 du mot de passe oublié : pose le nouveau mot de passe à
// partir du token reçu par email (voir /api/auth/mot-de-passe-oublie).
// Même politique de mot de passe que l'inscription et le changement de mot
// de passe connecté (lib/password-policy.ts) — aucune règle dupliquée.
//
// Sécurité :
// - Token vérifié ET expiration vérifiée avant toute écriture.
// - Rate-limité par IP (protège contre un bruteforce du token, même s'il
//   est cryptographiquement long).
// - Token à usage unique : effacé (resetPasswordToken=null) dès utilisation
//   réussie, qu'il ait servi ou qu'il ait expiré — jamais réutilisable.
// - Ne recrée jamais de session automatiquement : l'utilisateur doit se
//   reconnecter avec son nouveau mot de passe, comme après tout changement
//   de mot de passe (cohérent avec /api/auth/mot-de-passe déjà en place,
//   qui ne fait pas non plus de reconnexion automatique).
export async function POST(req: NextRequest) {
  const ip = adresseIp(req);
  const autorise = await verifierLimiteIp(`reinitialiser-mot-de-passe:${ip}`);
  if (!autorise) {
    return NextResponse.json(
      { error: "Trop de tentatives depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const corpsBrut = await req.json();
  const analyse = reinitialiserMotDePasseSchema.safeParse(corpsBrut);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { token, nouveauMotDePasse } = analyse.data;

  const user = await prisma.user.findUnique({ where: { resetPasswordToken: token } });
  if (!user) {
    return NextResponse.json(
      { error: "Ce lien de réinitialisation est invalide ou a déjà été utilisé." },
      { status: 400 }
    );
  }

  if (user.resetPasswordExpire && user.resetPasswordExpire < new Date()) {
    // Nettoie le token expiré pour ne pas laisser traîner un token mort.
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: null, resetPasswordExpire: null },
    });
    return NextResponse.json(
      { error: "Ce lien de réinitialisation a expiré. Demandez-en un nouveau." },
      { status: 400 }
    );
  }

  const politique = await validerMotDePasse(nouveauMotDePasse);
  if (!politique.ok) {
    return NextResponse.json({ error: politique.erreur }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(nouveauMotDePasse, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetPasswordToken: null,
      resetPasswordExpire: null,
      // Un mot de passe oublié réinitialisé avec succès est une preuve de
      // possession de la boîte mail : lève aussi un éventuel verrouillage
      // par échecs de connexion, pour ne pas bloquer l'utilisateur juste
      // après qu'il ait repris le contrôle de son compte.
      echecsConnexion: 0,
      verrouilleJusqua: null,
    },
  });

  return NextResponse.json({ ok: true, message: "Mot de passe réinitialisé. Vous pouvez vous connecter." });
}
