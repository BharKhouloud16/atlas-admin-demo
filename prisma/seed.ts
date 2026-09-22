// Remplit la base avec des données de démo prêtes à l'emploi :
// un client déjà validé, un ingénieur déjà validé, une mission.
// Usage : npx tsx prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// PHASE 14B — Security Hardening (22/09/2026) : ce script crée un compte
// ADMIN avec le mot de passe fixe "Demo1234" (en clair dans ce fichier,
// versionné) — jamais un risque en développement/CI (DATABASE_URL y pointe
// toujours vers une base jetable), mais dangereux si jamais exécuté par
// erreur contre une vraie base de production (ex. commande copiée depuis
// le README sans vérifier DATABASE_URL). Contrairement à
// app/api/dev-seed/route.ts (seul mécanisme de seed de la démo en ligne,
// donc volontairement actif en production, juste durci), ce script n'a
// aucune raison de tourner en production : refus net plutôt qu'un mot de
// passe aléatoire, pour rester le changement le plus simple possible.
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "prisma/seed.ts ne doit jamais être exécuté en production (mot de passe de démo fixe) — utilisez app/api/dev-seed/route.ts pour seeder un déploiement en ligne."
  );
}

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
