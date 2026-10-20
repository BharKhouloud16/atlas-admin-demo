import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  envoyerEmailInscriptionEnAttente,
  envoyerEmailTentativeInscriptionExistante,
  envoyerEmailVerificationAdresse,
  MESSAGE_EMAIL_INDISPONIBLE,
  parcoursEmailIndisponible,
} from "@/lib/email";
import { attendreDureeMinimale } from "@/lib/duree-reponse";
import { signupSchema, premierMessageZod } from "@/lib/validation";
import { validerMotDePasse } from "@/lib/password-policy";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";
import { lireCorpsJson, reponseErreurServeur } from "@/lib/api-errors";
import { avecLienDemo } from "@/lib/liens-demo";

// Durée de validité du lien de vérification d'adresse email
const VALIDITE_TOKEN_MS = 24 * 60 * 60 * 1000; // 24h

// SÉCURITÉ — anti-énumération : réponse strictement identique (statut 201,
// même corps, aucun identifiant interne) que l'adresse soit libre ou déjà
// inscrite. Avant correctif, une adresse existante renvoyait 409 « Un compte
// existe déjà avec cet email », ce qui permettait de tester n'importe quelle
// adresse. Le titulaire d'une adresse déjà inscrite reçoit à la place un
// email l'invitant à se connecter ou à réinitialiser son mot de passe.
const REPONSE_INSCRIPTION = {
  ok: true,
  message:
    "Demande d'inscription enregistrée. Si cette adresse peut être utilisée, un email de confirmation vient de vous être envoyé : confirmez votre adresse puis attendez la validation par l'administrateur.",
};

function genererTokenVerification() {
  return crypto.randomBytes(32).toString("hex");
}

// Inscription publique — jamais pour le rôle ADMIN (créé uniquement en base
// par un administrateur existant, voir prisma/create-admin.ts).
// Le compte créé démarre avec actif=false : il ne peut pas se connecter tant
// qu'un ADMIN ne l'a pas validé depuis /admin/comptes-en-attente.
// V1 : erreurs non prévues → réponse JSON contrôlée (voir lib/api-errors.ts).
export async function POST(req: NextRequest) {
  try {
    return await traiterInscription(req);
  } catch (erreur) {
    // Inscription concurrente sur le même email : la contrainte unique a
    // tranché entre les deux requêtes — même réponse générique que tout autre
    // cas (anti-énumération).
    if ((erreur as { code?: unknown } | null)?.code === "P2002") {
      return NextResponse.json(REPONSE_INSCRIPTION, { status: 201 });
    }
    return reponseErreurServeur(erreur, "/api/auth/signup");
  }
}

async function traiterInscription(req: NextRequest) {
  // Sur Vercel sans envoi d'email opérationnel : aucun compte n'est créé
  // (il ne pourrait jamais confirmer son adresse), refus identique pour toute
  // adresse, avant tout accès à la base (voir lib/email.ts).
  if (parcoursEmailIndisponible()) {
    return NextResponse.json({ error: MESSAGE_EMAIL_INDISPONIBLE }, { status: 503 });
  }

  const ip = adresseIp(req);
  const autoriseParIp = await verifierLimiteIp(`signup:${ip}`);
  if (!autoriseParIp) {
    return NextResponse.json(
      { error: "Trop de tentatives d'inscription depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const corpsBrut = await lireCorpsJson(req);
  if (corpsBrut === null) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
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

  const debut = Date.now();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Même coût de calcul que la création (hachage bcrypt) pour ne pas
    // trahir l'existence du compte par le temps de réponse ; aucune écriture.
    await bcrypt.hash(password, 12);
    await envoyerEmailTentativeInscriptionExistante({ to: email });
    await attendreDureeMinimale(debut);
    return NextResponse.json(REPONSE_INSCRIPTION, { status: 201 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const tokenVerification = genererTokenVerification();
  const expirationToken = new Date(Date.now() + VALIDITE_TOKEN_MS);

  if (role === "INGENIEUR") {
    // Crée une fiche Profil vide (sans tarif) que l'Admin complètera à la validation.
    // V1 : Profil + User créés dans une même transaction — un échec de la
    // seconde écriture (ex. inscription concurrente sur le même email, P2002)
    // ne laisse plus de fiche Profil orpheline.
    await prisma.$transaction(async (tx) => {
      const profil = await tx.profil.create({ data: { nom, prenom } });
      return tx.user.create({
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
    });
    const nomComplet = prenom ? `${prenom} ${nom}` : nom;
    await envoyerEmailInscriptionEnAttente({ to: email, nom: nomComplet, role: "INGENIEUR" });
    await envoyerEmailVerificationAdresse({ to: email, nom: nomComplet, token: tokenVerification });
    await attendreDureeMinimale(debut);
    // SÉCURITÉ : lien de vérification renvoyé uniquement en environnement de
    // test explicitement autorisé (voir lib/liens-demo.ts).
    return NextResponse.json(
      avecLienDemo(REPONSE_INSCRIPTION, "lienVerificationDemo",
        `/verifier-email?token=${tokenVerification}`
      ),
      { status: 201 }
    );
  }

  // role === "CLIENT" (Espace Partenaire)
  // V1 : Client + User dans une même transaction (pas de fiche Client orpheline).
  await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
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
    return tx.user.create({
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
  });
  await envoyerEmailInscriptionEnAttente({ to: email, nom, role: "CLIENT" });
  await envoyerEmailVerificationAdresse({ to: email, nom, token: tokenVerification });
  await attendreDureeMinimale(debut);
  return NextResponse.json(
    avecLienDemo(REPONSE_INSCRIPTION, "lienVerificationDemo",
      `/verifier-email?token=${tokenVerification}`
    ),
    { status: 201 }
  );
}
