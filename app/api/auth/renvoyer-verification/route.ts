import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { envoyerEmailVerificationAdresse, MESSAGE_EMAIL_INDISPONIBLE, parcoursEmailIndisponible } from "@/lib/email";
import { avecLienDemo } from "@/lib/liens-demo";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";
import { seuilExpirationRenvoi, VALIDITE_TOKEN_VERIFICATION_MS } from "@/lib/renvoi-verification";
import { attendreDureeMinimale } from "@/lib/duree-reponse";

// Réponse unique, que le compte existe ou non, qu'il soit déjà vérifié ou non,
// et que le renvoi ait été différé ou non : ne jamais révéler si un email est
// inscrit (avant correctif, un compte existant non vérifié recevait un
// message différent).
const REPONSE_GENERIQUE = {
  ok: true,
  message: "Si ce compte existe et n'est pas encore vérifié, un nouveau lien vient d'être envoyé.",
};

// Renvoie un nouveau lien de vérification par email (l'ancien peut avoir
// expiré ou s'être perdu).
export async function POST(req: NextRequest) {
  // Sur Vercel sans envoi d'email opérationnel : refus identique pour toute
  // adresse, avant tout accès à la base (voir lib/email.ts).
  if (parcoursEmailIndisponible()) {
    return NextResponse.json({ error: MESSAGE_EMAIL_INDISPONIBLE }, { status: 503 });
  }

  // Limitation par IP : même mécanisme que la connexion et l'inscription
  // (lib/rate-limit.ts, fenêtre de 15 min, seuil RATE_LIMIT_LOGIN_MAX_IP).
  const autorise = await verifierLimiteIp(`renvoyer-verification:${adresseIp(req)}`);
  if (!autorise) {
    return NextResponse.json({ error: "Trop de demandes depuis cette adresse. Réessayez plus tard." }, { status: 429 });
  }

  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email requis." }, { status: 400 });
  }
  const emailNormalise = email.trim().toLowerCase();
  const debut = Date.now();

  const user = await prisma.user.findUnique({ where: { email: emailNormalise } });
  if (!user || user.emailVerifie) {
    await attendreDureeMinimale(debut);
    return NextResponse.json(REPONSE_GENERIQUE);
  }

  // Délai minimal par compte (2 min, lib/renvoi-verification.ts), appliqué
  // par une mise à jour CONDITIONNELLE : PostgreSQL réévalue la condition au
  // moment de l'écriture, donc parmi des requêtes simultanées une seule
  // régénère le lien et envoie l'email ; les autres reçoivent la réponse
  // générique sans rien envoyer.
  const token = crypto.randomBytes(32).toString("hex");
  const { count } = await prisma.user.updateMany({
    where: {
      id: user.id,
      emailVerifie: false,
      OR: [{ emailVerificationExpire: null }, { emailVerificationExpire: { lte: seuilExpirationRenvoi() } }],
    },
    data: { emailVerificationToken: token, emailVerificationExpire: new Date(Date.now() + VALIDITE_TOKEN_VERIFICATION_MS) },
  });
  if (count !== 1) {
    await attendreDureeMinimale(debut);
    return NextResponse.json(REPONSE_GENERIQUE);
  }

  await envoyerEmailVerificationAdresse({ to: emailNormalise, nom: emailNormalise, token });
  await attendreDureeMinimale(debut);

  // SÉCURITÉ : lien renvoyé uniquement en environnement de test explicitement
  // autorisé (voir lib/liens-demo.ts) ; sinon réponse identique aux autres cas.
  return NextResponse.json(avecLienDemo(REPONSE_GENERIQUE, "lienVerificationDemo", `/verifier-email?token=${token}`));
}
