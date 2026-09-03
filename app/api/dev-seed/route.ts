import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Permet de remplir la base de données de démo depuis le navigateur, sans
// terminal — utile pour un déploiement Vercel où on ne peut pas taper de
// commande. Protégé par SEED_TOKEN : on ne peut l'appeler qu'en connaissant
// ce secret, pour ne pas laisser n'importe qui réinitialiser les données.
//
// Utilisation : ouvrir dans le navigateur
//   https://votre-site.vercel.app/api/dev-seed?token=VOTRE_SEED_TOKEN
//
// Ne fonctionne qu'une fois (les emails sont uniques) — pour recommencer,
// videz les tables User/Client/Profil/Mission depuis Supabase avant de
// rappeler cette route.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.SEED_TOKEN) {
    return NextResponse.json({ error: "Token invalide ou manquant" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email: "admin-demo@example.com" } });
  if (existing) {
    return NextResponse.json({ ok: true, message: "Données de démo déjà présentes, rien refait." });
  }

  await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });
  const passwordHash = await bcrypt.hash("Demo1234", 12);

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
    message: "Données de démo créées. Mot de passe pour tous les comptes : Demo1234",
    comptes: [
      "admin-demo@example.com (ADMIN)",
      "ingenieur-demo@example.com (INGENIEUR, déjà validé)",
      "client-demo@example.com (CLIENT, déjà validé)",
      "en-attente-demo@example.com (INGENIEUR, en attente de validation)",
    ],
  });
}
