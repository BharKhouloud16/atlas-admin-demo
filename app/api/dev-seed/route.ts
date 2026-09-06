import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";

// Permet de remplir la base de données de démo depuis le navigateur, sans
// terminal — utile pour un déploiement Vercel où on ne peut pas taper de
// commande (voir DEPLOIEMENT_DEMO_EN_LIGNE.md, qui documente cette route
// comme LE mécanisme de seed de la démo en ligne). Cette route reste donc
// active en production par design — cette "démo" n'a pas d'environnement
// de production séparé au sens habituel — mais est durcie (audit du
// 06/09) : jeton obligatoire (aucune valeur par défaut), comparaison en
// temps constant, limitation de débit par IP, et mot de passe aléatoire à
// usage unique en production plutôt que "Demo1234" en dur.
//
// Utilisation : ouvrir dans le navigateur
//   https://votre-site.vercel.app/api/dev-seed?token=VOTRE_SEED_TOKEN
//
// Ne fonctionne qu'une fois (les emails sont uniques) — pour recommencer,
// videz les tables User/Client/Profil/Mission depuis Supabase avant de
// rappeler cette route.

// Compare deux chaînes en temps constant, sans fuiter leur longueur (on
// compare toujours des empreintes SHA-256 de taille fixe, jamais les
// chaînes brutes qui peuvent avoir des longueurs différentes — un
// crypto.timingSafeEqual direct sur deux Buffer de tailles différentes
// lève une exception plutôt que de comparer, ce qui serait un boolean
// détournable).
function comparaisonSure(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function GET(req: NextRequest) {
  const seedToken = process.env.SEED_TOKEN;
  if (!seedToken) {
    // Aucune valeur par défaut : si la variable n'est pas configurée, la
    // route est indisponible plutôt que de tomber sur une comparaison
    // ambiguë avec `undefined`.
    return NextResponse.json({ error: "Route de seed non configurée." }, { status: 403 });
  }

  const ip = adresseIp(req);
  const autorise = await verifierLimiteIp(`dev-seed:${ip}`);
  if (!autorise) {
    return NextResponse.json(
      { error: "Trop de tentatives sur cette route depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token || !comparaisonSure(token, seedToken)) {
    return NextResponse.json({ error: "Token invalide ou manquant" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: "admin-demo@example.com" } });
  if (existing) {
    return NextResponse.json({ ok: true, message: "Données de démo déjà présentes, rien refait." });
  }

  // En production, jamais le mot de passe fixe "Demo1234" (documenté en
  // clair dans ce fichier et dans DEPLOIEMENT_DEMO_EN_LIGNE.md) : un mot
  // de passe aléatoire est généré à chaque appel et renvoyé une seule fois
  // dans la réponse. Hors production (CI locale, `npx tsx prisma/seed.ts`
  // via prisma/seed.ts qui reste inchangé), "Demo1234" est conservé pour
  // ne pas casser les habitudes de développement/tests.
  const motDePasse =
    process.env.NODE_ENV === "production" ? crypto.randomBytes(9).toString("base64url") : "Demo1234";
  const passwordHash = await bcrypt.hash(motDePasse, 12);

  await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });

  const client = await prisma.client.create({
    data: { nom: "Client Démo SAS", secteur: "E-commerce", contactReferent: "M. Dupont, RSSI", email: "client-demo@example.com" },
  });
  await prisma.user.create({
    data: { email: "client-demo@example.com", passwordHash, role: "CLIENT", actif: true, clientId: client.id },
  });

  const profil = await prisma.profil.create({ data: { nom: "Ingénieur Démo", type: "SALARIE", montantSaisi: 60000 } });
  await prisma.user.create({
    data: { email: "ingenieur-demo@example.com", passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id },
  });

  await prisma.user.create({
    data: { email: "admin-demo@example.com", passwordHash, role: "ADMIN", actif: true },
  });

  await prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, repere: "Audit Q4 2026", nbJours: 10, tjmVente: 900 },
  });

  const profilEnAttente = await prisma.profil.create({ data: { nom: "Nouvel Ingénieur (test)" } });
  await prisma.user.create({
    data: { email: "en-attente-demo@example.com", passwordHash, role: "INGENIEUR", actif: false, profilId: profilEnAttente.id },
  });

  return NextResponse.json({
    ok: true,
    message: `Données de démo créées. Mot de passe pour tous les comptes : ${motDePasse}`,
    comptes: [
      "admin-demo@example.com (ADMIN)",
      "ingenieur-demo@example.com (INGENIEUR, déjà validé)",
      "client-demo@example.com (CLIENT, déjà validé)",
      "en-attente-demo@example.com (INGENIEUR, en attente de validation)",
    ],
  });
}
