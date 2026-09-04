import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { envoyerEmailInscriptionEnAttente, envoyerEmailVerificationAdresse } from "@/lib/email";

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
  const body = await req.json();
  const { email, password, role, nom, consentementRgpd } = body;
  const prenom: string | undefined = body.prenom;

  if (!email || !password || !role || !nom) {
    return NextResponse.json({ error: "Email, mot de passe, rôle et nom sont requis" }, { status: 400 });
  }
  if (role === "INGENIEUR" && !prenom) {
    return NextResponse.json({ error: "Le prénom est requis" }, { status: 400 });
  }
  if (role !== "INGENIEUR" && role !== "CLIENT") {
    return NextResponse.json({ error: "Inscription possible uniquement pour Ingénieur ou Client" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Le mot de passe doit contenir au moins 8 caractères" }, { status: 400 });
  }
  if (role === "CLIENT" && !body.telephone) {
    return NextResponse.json({ error: "Le numéro de téléphone est requis" }, { status: 400 });
  }
  // Consentement RGPD obligatoire au traitement des données (voir
  // /confidentialite) — horodaté comme preuve de consentement.
  if (consentementRgpd !== true) {
    return NextResponse.json(
      { error: "Merci d'accepter le traitement de vos données (RGPD) pour créer un compte." },
      { status: 400 }
    );
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
