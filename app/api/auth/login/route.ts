import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { loginSchema, premierMessageZod } from "@/lib/validation";
import { adresseIp, verifierLimiteIp, enregistrerEchecConnexion, reinitialiserEchecsConnexion } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = adresseIp(req);
  const autoriseParIp = await verifierLimiteIp(`login:${ip}`);
  if (!autoriseParIp) {
    return NextResponse.json(
      { error: "Trop de tentatives de connexion depuis cette adresse. Réessayez dans quelques minutes." },
      { status: 429 }
    );
  }

  const corps = await req.json();
  const analyse = loginSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { email, password } = analyse.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // même message que mot de passe invalide : ne pas révéler si l'email existe
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  if (user.verrouilleJusqua && user.verrouilleJusqua.getTime() > Date.now()) {
    return NextResponse.json(
      { error: "Compte temporairement verrouillé après plusieurs échecs de connexion. Réessayez dans quelques minutes." },
      { status: 429 }
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await enregistrerEchecConnexion(user.id, user.echecsConnexion);
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  await reinitialiserEchecsConnexion(user.id);

  if (!user.emailVerifie) {
    return NextResponse.json(
      {
        error:
          "Merci de confirmer votre adresse email avant de vous connecter (lien envoyé lors de votre inscription).",
      },
      { status: 403 }
    );
  }

  if (!user.actif) {
    return NextResponse.json(
      { error: "Votre compte est en attente de validation par l'administrateur." },
      { status: 403 }
    );
  }

  await createSession({
    email: user.email,
    role: user.role,
    profilId: user.profilId,
    clientId: user.clientId,
    desactive: user.desactive,
  });

  if (!user.premiereConnexionLe) {
    await prisma.user.update({ where: { id: user.id }, data: { premiereConnexionLe: new Date() } });
  }

  // indique au front vers quel espace rediriger : un ingénieur ayant
  // temporairement désactivé son compte est redirigé vers l'écran de
  // réactivation plutôt que son espace habituel (voir middleware.ts).
  const redirect =
    user.role === "INGENIEUR" && user.desactive
      ? "/ingenieur/compte-desactive"
      : user.role === "CLIENT"
      ? "/client"
      : "/admin";
  return NextResponse.json({ ok: true, role: user.role, redirect });
}
