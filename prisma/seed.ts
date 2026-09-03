// Remplit la base avec des données de démo prêtes à l'emploi :
// un client déjà validé, un ingénieur déjà validé, une mission.
// Usage : npx tsx prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });

  const passwordHash = await bcrypt.hash("Demo1234", 12);

  // --- Client de démo (déjà validé, actif=true) ---
  const client = await prisma.client.create({
    data: {
      nom: "Client Démo SAS",
      secteur: "E-commerce",
      contactReferent: "M. Dupont, RSSI",
      email: "client-demo@example.com",
    },
  });
  await prisma.user.create({
    data: { email: "client-demo@example.com", passwordHash, role: "CLIENT", actif: true, clientId: client.id },
  });

  // --- Ingénieur de démo (déjà validé, tarif déjà fixé) ---
  const profil = await prisma.profil.create({
    data: { nom: "Ingénieur Démo", type: "SALARIE", montantSaisi: 60000 },
  });
  await prisma.user.create({
    data: { email: "ingenieur-demo@example.com", passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id },
  });

  // --- Admin de démo ---
  await prisma.user.upsert({
    where: { email: "admin-demo@example.com" },
    update: {},
    create: { email: "admin-demo@example.com", passwordHash, role: "ADMIN", actif: true },
  });

  // --- Une mission déjà en cours, pour voir tout de suite les chiffres ---
  await prisma.mission.create({
    data: {
      clientId: client.id,
      profilId: profil.id,
      repere: "Audit Q4 2026",
      nbJours: 10,
      tjmVente: 900,
    },
  });

  // --- Un compte ingénieur en attente, pour tester le circuit de validation ---
  const profilEnAttente = await prisma.profil.create({ data: { nom: "Nouvel Ingénieur (test)" } });
  await prisma.user.create({
    data: { email: "en-attente-demo@example.com", passwordHash, role: "INGENIEUR", actif: false, profilId: profilEnAttente.id },
  });

  console.log("Données de démo créées. Mot de passe pour tous les comptes : Demo1234");
  console.log("- admin-demo@example.com (ADMIN)");
  console.log("- ingenieur-demo@example.com (INGENIEUR, déjà validé)");
  console.log("- client-demo@example.com (CLIENT, déjà validé)");
  console.log("- en-attente-demo@example.com (INGENIEUR, EN ATTENTE — pour tester /admin/comptes-en-attente)");
}

main().finally(() => prisma.$disconnect());
