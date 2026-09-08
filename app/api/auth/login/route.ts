import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { loginSchema, premierMessageZod } from "@/lib/validation";
import { adresseIp, verifierLimiteIp, enregistrerEchecConnexion, reinitialiserEchecsConnexion } from "@/lib/rate-limit";
import { verifierCode } from "@/lib/totp";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

export async function POST(req: NextRequest) {
  const ip = adresseIp(req);
  // ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16,
  // 08/09/2026) : un seul correlationId pour toute cette tentative de
  // connexion, même si plusieurs événements sont écrits en chemin (ex.
  // limite IP puis, sur une tentative suivante, échec de mot de passe) —
  // voir lib/security/events.ts. Écriture best-effort, jamais bloquante.
  const correlationId = nouveauCorrelationId();
  const contexteRoute = "/api/auth/login";

  const autoriseParIp = await verifierLimiteIp(`login:${ip}`);
  if (!autoriseParIp) {
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.limite_ip",
      resultat: "REFUSE",
      severite: "ATTENTION",
      contexteIp: ip,
      contexteRoute,
    });
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
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.echec",
      resultat: "REFUSE",
      severite: "INFO",
      contexteIp: ip,
      contexteRoute,
      acteurEmail: email,
    });
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  if (user.verrouilleJusqua && user.verrouilleJusqua.getTime() > Date.now()) {
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.compte_verrouille",
      resultat: "REFUSE",
      severite: "ATTENTION",
      contexteIp: ip,
      contexteRoute,
      acteurEmail: user.email,
      acteurRole: user.role,
      acteurId: user.id,
    });
    return NextResponse.json(
      { error: "Compte temporairement verrouillé après plusieurs échecs de connexion. Réessayez dans quelques minutes." },
      { status: 429 }
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await enregistrerEchecConnexion(user.id, user.echecsConnexion);
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.echec",
      resultat: "REFUSE",
      severite: "INFO",
      contexteIp: ip,
      contexteRoute,
      acteurEmail: user.email,
      acteurRole: user.role,
      acteurId: user.id,
    });
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  await reinitialiserEchecsConnexion(user.id);

  if (!user.emailVerifie) {
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.email_non_verifie",
      resultat: "REFUSE",
      severite: "INFO",
      contexteIp: ip,
      contexteRoute,
      acteurEmail: user.email,
      acteurRole: user.role,
      acteurId: user.id,
    });
    return NextResponse.json(
      {
        error:
          "Merci de confirmer votre adresse email avant de vous connecter (lien envoyé lors de votre inscription).",
      },
      { status: 403 }
    );
  }

  if (!user.actif) {
    await enregistrerEvenementSecurite({
      correlationId,
      action: "auth.login.compte_inactif",
      resultat: "REFUSE",
      severite: "INFO",
      contexteIp: ip,
      contexteRoute,
      acteurEmail: user.email,
      acteurRole: user.role,
      acteurId: user.id,
    });
    return NextResponse.json(
      { error: "Votre compte est en attente de validation par l'administrateur." },
      { status: 403 }
    );
  }

  // 2FA (TOTP), réservé à l'Admin — voir lib/totp.ts et
  // app/api/auth/2fa/*. Le code (ou un code de secours à usage unique) est
  // demandé ici, dans le même appel : plutôt qu'une session intermédiaire,
  // le front renvoie email+password+code ensemble une fois le code saisi
  // (voir app/connexion/page.tsx), ce qui évite tout état de session
  // partiellement authentifiée côté serveur.
  if (user.role === "ADMIN" && user.totpActif && user.totpSecret) {
    const code = typeof corps?.code === "string" ? corps.code : "";
    if (!code) {
      await enregistrerEvenementSecurite({
        correlationId,
        action: "auth.login.totp_requis",
        resultat: "REFUSE",
        severite: "INFO",
        contexteIp: ip,
        contexteRoute,
        acteurEmail: user.email,
        acteurRole: user.role,
        acteurId: user.id,
      });
      return NextResponse.json({ error: "Code de vérification requis.", requiresTotp: true }, { status: 401 });
    }

    let codeValide = verifierCode(code, user.totpSecret);
    if (!codeValide && user.totpCodesSecours) {
      const hashes: string[] = JSON.parse(user.totpCodesSecours);
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(code.trim(), hashes[i])) {
          codeValide = true;
          hashes.splice(i, 1); // usage unique : retiré une fois consommé
          await prisma.user.update({ where: { id: user.id }, data: { totpCodesSecours: JSON.stringify(hashes) } });
          break;
        }
      }
    }

    if (!codeValide) {
      await enregistrerEvenementSecurite({
        correlationId,
        action: "auth.login.totp_invalide",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: ip,
        contexteRoute,
        acteurEmail: user.email,
        acteurRole: user.role,
        acteurId: user.id,
      });
      return NextResponse.json({ error: "Code de vérification invalide.", requiresTotp: true }, { status: 401 });
    }
  }

  await createSession({
    email: user.email,
    role: user.role,
    profilId: user.profilId,
    clientId: user.clientId,
    desactive: user.desactive,
  });

  await enregistrerEvenementSecurite({
    correlationId,
    action: "auth.login.succes",
    resultat: "SUCCES",
    severite: "INFO",
    contexteIp: ip,
    contexteRoute,
    acteurEmail: user.email,
    acteurRole: user.role,
    acteurId: user.id,
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
