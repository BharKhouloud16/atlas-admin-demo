// Crée (ou met à jour) le compte ADMIN — le seul rôle qui ne passe jamais
// par l'inscription publique /inscription.
// Usage : npx tsx prisma/create-admin.ts <email> <mot_de_passe>
//
// LOT 15.2 — durci pour devenir le mécanisme OFFICIEL de bootstrap Admin en
// Production, à la place de l'ancien endpoint HTTP public /api/dev-seed
// (supprimé) : aucun endpoint de bootstrap ne doit exister en Production.
// Mêmes protections que le reste de l'authentification (bcryptjs, 12
// rounds — voir app/api/auth/login/route.ts) — jamais une seconde
// implémentation du hash.
//
// Règles (jamais contournables silencieusement, toujours via une vraie
// confirmation interactive au terminal) :
// 1. Email existant avec un rôle différent de ADMIN -> REFUS, aucune
//    modification (protection contre une élévation de privilèges
//    accidentelle sur un compte CLIENT/INGENIEUR par erreur de frappe).
// 2. Email existant avec role=ADMIN -> jamais un écrasement silencieux du
//    mot de passe : confirmation explicite requise, et seul passwordHash
//    est modifié (aucun autre attribut du compte n'est touché).
// 3. Email inexistant -> création avec le strict minimum (email,
//    passwordHash, role=ADMIN) ; tous les autres champs (actif,
//    emailVerifie, desactive, echecsConnexion, verrouilleJusqua,
//    totpActif) suivent leurs valeurs par défaut du schéma Prisma —
//    aucune valeur arbitraire introduite ici.
// 4. NODE_ENV=production -> confirmation explicite supplémentaire avant
//    toute écriture, quel que soit le cas (création ou reset) — jamais
//    contournable automatiquement, jamais d'affichage de DATABASE_URL.
//
// Pas de transaction : chaque chemin n'effectue qu'un seul appel Prisma
// (create OU update), et la contrainte unique sur `email` protège déjà
// contre un doublon en cas de course — une transaction n'apporterait
// aucune garantie supplémentaire ici pour un outil CLI à usage ponctuel.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "readline";

export type DemanderConfirmation = (question: string) => Promise<boolean>;

export type ResultatBootstrapAdmin =
  | { statut: "CREE"; email: string }
  | { statut: "MOT_DE_PASSE_MIS_A_JOUR"; email: string }
  | { statut: "REFUSE_ROLE_EXISTANT"; email: string; roleExistant: string }
  | { statut: "ANNULE_SANS_CONFIRMATION"; email: string };

export async function confirmerProductionSiNecessaire(
  nodeEnv: string | undefined,
  demanderConfirmation: DemanderConfirmation
): Promise<boolean> {
  if (nodeEnv !== "production") return true;
  return demanderConfirmation(
    "ATTENTION : NODE_ENV=production. Cette commande va modifier la base de données configurée. Continuer ? [y/N] "
  );
}

export async function bootstrapAdmin(
  prisma: PrismaClient,
  email: string,
  motDePasse: string,
  demanderConfirmation: DemanderConfirmation
): Promise<ResultatBootstrapAdmin> {
  const existant = await prisma.user.findUnique({ where: { email }, select: { role: true } });

  if (existant && existant.role !== "ADMIN") {
    return { statut: "REFUSE_ROLE_EXISTANT", email, roleExistant: existant.role };
  }

  if (existant) {
    const confirme = await demanderConfirmation(
      `Un compte ADMIN existe déjà pour ${email}. Confirmer la réinitialisation du mot de passe ? [y/N] `
    );
    if (!confirme) {
      return { statut: "ANNULE_SANS_CONFIRMATION", email };
    }
    const passwordHash = await bcrypt.hash(motDePasse, 12);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    return { statut: "MOT_DE_PASSE_MIS_A_JOUR", email };
  }

  const passwordHash = await bcrypt.hash(motDePasse, 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN" } });
  return { statut: "CREE", email };
}

function demanderConfirmationReelle(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (reponse) => {
      rl.close();
      const normalisee = reponse.trim().toLowerCase();
      resolve(normalisee === "y" || normalisee === "yes");
    });
  });
}

async function main() {
  const [email, motDePasse] = process.argv.slice(2);
  if (!email || !motDePasse) {
    console.error("Usage : npx tsx prisma/create-admin.ts <email> <mot_de_passe>");
    process.exitCode = 1;
    return;
  }

  const productionOk = await confirmerProductionSiNecessaire(process.env.NODE_ENV, demanderConfirmationReelle);
  if (!productionOk) {
    console.error("Opération annulée (confirmation Production refusée). Aucune modification effectuée.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const resultat = await bootstrapAdmin(prisma, email, motDePasse, demanderConfirmationReelle);
    switch (resultat.statut) {
      case "CREE":
        console.log(`Compte admin créé : ${resultat.email}`);
        break;
      case "MOT_DE_PASSE_MIS_A_JOUR":
        console.log(`Mot de passe réinitialisé : ${resultat.email}`);
        break;
      case "REFUSE_ROLE_EXISTANT":
        console.error(
          `Refusé : ${resultat.email} existe déjà avec le rôle ${resultat.roleExistant} — aucune modification effectuée.`
        );
        process.exitCode = 1;
        break;
      case "ANNULE_SANS_CONFIRMATION":
        console.log(`Annulé : aucune modification effectuée pour ${resultat.email}.`);
        break;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Ne s'exécute que lorsque ce fichier est lancé directement (CLI) — jamais
// quand il est importé par les tests (voir tests/unit/create-admin.spec.ts),
// qui appellent bootstrapAdmin() directement avec une confirmation simulée.
if (require.main === module) {
  main();
}
