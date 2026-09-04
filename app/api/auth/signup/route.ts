import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { envoyerEmailInscriptionEnAttente, envoyerEmailVerificationAdresse } from "@/lib/email";
import { signupSchema, premierMessageZod } from "@/lib/validation";
import { validerMotDePasse } from "@/lib/password-policy";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";

// Durée de validité du lien de vérification d'adresse email
const VALIDITE_TOKEN_MS = 24 * 60 * 60 * 1000; // 24h

function genererTokenVerification() {
  return crypto.randomBytes(32).toString("hex");
}

// Inscription publique — jamais pour le rôle ADMIN (créé uniquement en base
// par un administrateur existant, voir prisma/create-admin.ts).
// Le compte créé démarre avec actif=false : il ne peut pas se connecter tant
// qu'un ADMIN ne l'a pas validé depuis /admin/comptes-en-attente.
export async function POST(req: NextRequest) {
  const ip = adresseIp(req);
  const autoriseParIp = await verifierLimiteIp(`signup:${ip}`);
  if (!autoriseParIp) {
    return NextResponse.json(
      { error: "Trop de tentatives d'inscription depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const corpsBrut = await req.json();
  const analyse = signupSchema.safeParse(corpsBrut);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const body = analyse.data;
  const { email, password, role, nom } = body;
  const prenom: string | undefined = body.prenom;

  const politique = await validerMotDePasse(password);
  if (!politique.ok) {
    return NextResponse.json({ error: politique.erreur }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const tokenVerification = genererTokenVerification();
  const expirationToken = new Date(Date.now() + VALIDITE_TOKEN_MS);

  if (role === "INGENIEUR") {
    // Crée une fiche Profil vide (sans tarif) que l'Admin complètera à la validation
    const profil = await prisma.profil.create({ data: { nom, prenom } });
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "INGENIEUR",
        actif: false,
        profilId: profil.id,
        emailVerifie: false,
        emailVerificationToken: tokenVerification,
        emailVerificationExpire: expirationToken,
        consentementRgpd: true,
        consentementRgpdLe: new Date(),
      },
    });
    const nomComplet = prenom ? `${prenom} ${nom}` : nom;
    await envoyerEmailInscriptionEnAttente({ to: email, nom: nomComplet, role: "INGENIEUR" });
    await envoyerEmailVerificationAdresse({ to: email, nom: nomComplet, token: tokenVerification });
    return NextResponse.json(
      {
        ok: true,
        message:
          "Compte créé. Confirmez votre adresse email (lien envoyé) puis attendez la validation par l'administrateur.",
        id: user.id,
        // ⚠️ Démo : aucun fournisseur d'email n'est branché (voir lib/email.ts), le
        // lien n'arrive donc pas réellement en boîte de réception pour l'instant —
        // il est renvoyé ici pour permettre de tester le parcours de vérification.
        lienVerificationDemo: `/verifier-email?token=${tokenVerification}`,
      },
      { status: 201 }
    );
  }

  // role === "CLIENT" (Espace Partenaire)
  const client = await prisma.client.create({
    data: {
      nom, // raison sociale
      email,
      contactReferent: body.contactReferent ?? null,
      telephone: body.telephone ?? null,
      identifiantEntreprise: body.identifiantEntreprise ?? null,
      formeJuridique: body.formeJuridique ?? null,
      secteur: body.secteur ?? null,
    },
  });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "CLIENT",
      actif: false,
      clientId: client.id,
      emailVerifie: false,
      emailVerificationToken: tokenVerification,
      emailVerificationExpire: expirationToken,
      consentementRgpd: true,
      consentementRgpdLe: new Date(),
    },
  });
  await envoyerEmailInscriptionEnAttente({ to: email, nom, role: "CLIENT" });
  await envoyerEmailVerificationAdresse({ to: email, nom, token: tokenVerification });
  return NextResponse.json(
    {
      ok: true,
      message:
        "Compte créé. Confirmez votre adresse email (lien envoyé) puis attendez la validation par l'administrateur.",
      id: user.id,
      lienVerificationDemo: `/verifier-email?token=${tokenVerification}`,
    },
    { status: 201 }
  );
}
