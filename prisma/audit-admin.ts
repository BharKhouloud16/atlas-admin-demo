/**
 * Audit READ-ONLY du compte ADMIN ATLAS en Production.
 *
 * Ne modifie jamais le compte ni la base.
 * Exige une cible attendue explicite et refuse si l'empreinte de DATABASE_URL
 * ne correspond pas au libellé attendu.
 *
 * Usage :
 *   ATLAS_EXPECTED_DB_LABEL=supabase-historique npx tsx prisma/audit-admin.ts contact@atlas-qa.com
 *
 * Ne jamais afficher/coller DATABASE_URL, passwordHash, secrets TOTP ou codes de secours.
 */
import { PrismaClient } from "@prisma/client";
import { identifierCibleBase } from "../lib/db-target";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const expectedLabel = process.env.ATLAS_EXPECTED_DB_LABEL;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage : ATLAS_EXPECTED_DB_LABEL=<libellé attendu> npx tsx prisma/audit-admin.ts <email>");
  }
  if (!expectedLabel) {
    throw new Error("Refus : définir ATLAS_EXPECTED_DB_LABEL avec le libellé exact attendu.");
  }

  const target = identifierCibleBase(process.env.DATABASE_URL);
  if (target.type !== "supabase" || target.libelle !== expectedLabel) {
    throw new Error(
      `Refus : cible inattendue (type=${target.type}, libellé=${target.libelle ?? "inconnu"}). Aucune requête exécutée.`
    );
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return tx.user.findUnique({
      where: { email },
      select: {
        email: true,
        role: true,
        actif: true,
        emailVerifie: true,
        echecsConnexion: true,
        verrouilleJusqua: true,
        totpActif: true,
        totpSecret: true,
        totpCodesSecours: true,
        premiereConnexionLe: true,
      },
    });
  });

  if (!user) {
    console.log(JSON.stringify({ cible: target.libelle, compteTrouve: false }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    cible: target.libelle,
    compteTrouve: true,
    email: user.email,
    role: user.role,
    actif: user.actif,
    emailVerifie: user.emailVerifie,
    echecsConnexion: user.echecsConnexion,
    verrouilleJusqua: user.verrouilleJusqua,
    totpActif: user.totpActif,
    totpSecretConfigure: Boolean(user.totpSecret),
    codesSecoursDisponibles: user.totpCodesSecours
      ? safeCountRecoveryCodes(user.totpCodesSecours)
      : 0,
    premiereConnexionLe: user.premiereConnexionLe,
  }, null, 2));
}

function safeCountRecoveryCodes(serialized: string): number {
  try {
    const value: unknown = JSON.parse(serialized);
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Échec de l'audit.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
