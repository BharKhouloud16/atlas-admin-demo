// Crée (ou met à jour) le compte ADMIN — le seul rôle qui ne passe jamais
// par l'inscription publique /inscription.
// Usage : npx tsx prisma/create-admin.ts <email> <mot_de_passe>
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage : npx tsx prisma/create-admin.ts <email> <mot_de_passe>");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", actif: true },
    create: { email, passwordHash, role: "ADMIN", actif: true },
  });

  console.log(`Compte admin prêt : ${user.email}`);
}

main().finally(() => prisma.$disconnect());
