import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { bootstrapAdmin, confirmerProductionSiNecessaire, type DemanderConfirmation } from "@/prisma/create-admin";

// ATLAS LOT 15.2 — SUPPRESSION "/api/dev-seed" & DURCISSEMENT DU BOOTSTRAP
// ADMIN (29/09/2026).
//
// prisma/create-admin.ts est désormais le SEUL mécanisme de bootstrap du
// premier compte ADMIN (l'ancien endpoint HTTP public /api/dev-seed a été
// retiré). Ces tests appellent bootstrapAdmin() directement (jamais un
// vrai terminal, jamais une vraie confirmation interactive) avec une
// fonction de confirmation simulée — jamais contre une base de production
// réelle (voir tests/setup et .env de cet environnement de test/CI).

function confirmationFixe(reponse: boolean): DemanderConfirmation {
  return async () => reponse;
}

function espionnerConsole() {
  const appels: string[] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => {
    appels.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    appels.push(args.map(String).join(" "));
  };
  return {
    appels,
    restaurer: () => {
      console.log = logOriginal;
      console.error = errorOriginal;
    },
  };
}

let compteur = 0;
function emailUnique(prefixe: string): string {
  compteur += 1;
  return `${prefixe}-lot152-${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}@test.local`;
}

test.describe("prisma/create-admin.ts — Test 1 : nouvel email", () => {
  test("crée un compte ADMIN fonctionnel", async () => {
    const email = emailUnique("nouvel-admin");
    const resultat = await bootstrapAdmin(prisma, email, "MotDePasseTest123!", confirmationFixe(false));

    expect(resultat.statut).toBe("CREE");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user!.role).toBe("ADMIN");
    // Defaults Prisma respectés, jamais imposés explicitement par le script :
    expect(user!.actif).toBe(true);
    expect(user!.emailVerifie).toBe(true);
    expect(user!.desactive).toBe(false);
    expect(user!.echecsConnexion).toBe(0);
    expect(user!.verrouilleJusqua).toBeNull();
    expect(user!.totpActif).toBe(false);
  });
});

test.describe("prisma/create-admin.ts — Test 2 : email existant CLIENT", () => {
  test("refuse, aucun changement", async () => {
    const email = emailUnique("client-existant");
    const client = await prisma.client.create({ data: { nom: "Client Lot 15.2" } });
    const hashOriginal = await bcrypt.hash("MotDePasseOriginal", 12);
    await prisma.user.create({ data: { email, passwordHash: hashOriginal, role: "CLIENT", clientId: client.id } });

    const resultat = await bootstrapAdmin(prisma, email, "NouveauMotDePasse123!", confirmationFixe(true));

    expect(resultat.statut).toBe("REFUSE_ROLE_EXISTANT");
    expect((resultat as any).roleExistant).toBe("CLIENT");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.role).toBe("CLIENT");
    expect(user!.passwordHash).toBe(hashOriginal); // mot de passe jamais touché
  });
});

test.describe("prisma/create-admin.ts — Test 3 : email existant INGENIEUR", () => {
  test("refuse, aucun changement", async () => {
    const email = emailUnique("ingenieur-existant");
    const hashOriginal = await bcrypt.hash("MotDePasseOriginal", 12);
    await prisma.user.create({ data: { email, passwordHash: hashOriginal, role: "INGENIEUR" } });

    const resultat = await bootstrapAdmin(prisma, email, "NouveauMotDePasse123!", confirmationFixe(true));

    expect(resultat.statut).toBe("REFUSE_ROLE_EXISTANT");
    expect((resultat as any).roleExistant).toBe("INGENIEUR");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.role).toBe("INGENIEUR");
    expect(user!.passwordHash).toBe(hashOriginal);
  });
});

test.describe("prisma/create-admin.ts — Test 4 : email existant ADMIN sans confirmation", () => {
  test("aucune modification", async () => {
    const email = emailUnique("admin-existant-refus");
    const hashOriginal = await bcrypt.hash("MotDePasseOriginal", 12);
    await prisma.user.create({ data: { email, passwordHash: hashOriginal, role: "ADMIN" } });

    const resultat = await bootstrapAdmin(prisma, email, "NouveauMotDePasse123!", confirmationFixe(false));

    expect(resultat.statut).toBe("ANNULE_SANS_CONFIRMATION");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.passwordHash).toBe(hashOriginal);
  });
});

test.describe("prisma/create-admin.ts — Test 5 : email existant ADMIN avec confirmation", () => {
  test("changement du mot de passe autorisé", async () => {
    const email = emailUnique("admin-existant-reset");
    const hashOriginal = await bcrypt.hash("MotDePasseOriginal", 12);
    await prisma.user.create({ data: { email, passwordHash: hashOriginal, role: "ADMIN" } });

    const resultat = await bootstrapAdmin(prisma, email, "NouveauMotDePasse123!", confirmationFixe(true));

    expect(resultat.statut).toBe("MOT_DE_PASSE_MIS_A_JOUR");
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.passwordHash).not.toBe(hashOriginal);
    expect(await bcrypt.compare("NouveauMotDePasse123!", user!.passwordHash)).toBe(true);
  });
});

test.describe("prisma/create-admin.ts — Test 6 : hash compatible bcrypt.compare()", () => {
  test("le hash produit vérifie correctement le mot de passe fourni", async () => {
    const email = emailUnique("hash-verif");
    await bootstrapAdmin(prisma, email, "UnMotDePasseTresLong456!", confirmationFixe(false));

    const user = await prisma.user.findUnique({ where: { email } });
    expect(await bcrypt.compare("UnMotDePasseTresLong456!", user!.passwordHash)).toBe(true);
    expect(await bcrypt.compare("un-mauvais-mot-de-passe", user!.passwordHash)).toBe(false);
  });
});

test.describe("prisma/create-admin.ts — Test 7 : aucune fuite du mot de passe", () => {
  test("le mot de passe n'apparaît jamais dans un log", async () => {
    const email = emailUnique("pas-de-fuite");
    const motDePasseSecret = "CeMotDePasseNeDoitJamaisEtreLogge789!";
    const console_ = espionnerConsole();
    try {
      await bootstrapAdmin(prisma, email, motDePasseSecret, confirmationFixe(false));
      await bootstrapAdmin(prisma, email, motDePasseSecret, confirmationFixe(true)); // reset, 2e chemin
    } finally {
      console_.restaurer();
    }

    const tout = console_.appels.join("\n");
    expect(tout).not.toContain(motDePasseSecret);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(tout).not.toContain(user!.passwordHash);
  });
});

test.describe("prisma/create-admin.ts — Test 8 : reset Admin ne touche aucun autre attribut", () => {
  test("seul passwordHash change lors d'un reset", async () => {
    const email = emailUnique("reset-attributs");
    const hashOriginal = await bcrypt.hash("Original", 12);
    const avant = await prisma.user.create({
      data: { email, passwordHash: hashOriginal, role: "ADMIN", totpActif: false },
    });

    await bootstrapAdmin(prisma, email, "NouveauMotDePasse999!", confirmationFixe(true));

    const apres = await prisma.user.findUnique({ where: { email } });
    expect(apres!.passwordHash).not.toBe(hashOriginal);
    expect(apres!.role).toBe(avant.role);
    expect(apres!.actif).toBe(avant.actif);
    expect(apres!.emailVerifie).toBe(avant.emailVerifie);
    expect(apres!.desactive).toBe(avant.desactive);
    expect(apres!.echecsConnexion).toBe(avant.echecsConnexion);
    expect(apres!.totpActif).toBe(avant.totpActif);
    expect(apres!.createdAt.getTime()).toBe(avant.createdAt.getTime());
  });
});

test.describe("prisma/create-admin.ts — Test 9 : protection NODE_ENV=production", () => {
  test("hors production, aucune confirmation requise", async () => {
    const confirme = await confirmerProductionSiNecessaire("test", confirmationFixe(false));
    expect(confirme).toBe(true);
  });

  test("en production, la confirmation est consultée et respectée si refusée", async () => {
    let questionPosee: string | null = null;
    const confirmationEspionnee: DemanderConfirmation = async (question) => {
      questionPosee = question;
      return false;
    };
    const confirme = await confirmerProductionSiNecessaire("production", confirmationEspionnee);
    expect(confirme).toBe(false);
    expect(questionPosee).toContain("NODE_ENV=production");
    expect(questionPosee).not.toContain("DATABASE_URL"); // jamais afficher la variable elle-même
  });

  test("en production, la confirmation est respectée si acceptée", async () => {
    const confirme = await confirmerProductionSiNecessaire("production", confirmationFixe(true));
    expect(confirme).toBe(true);
  });
});
