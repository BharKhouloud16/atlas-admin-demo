// V1 — réinitialisation des mots de passe des 3 comptes de démonstration
// (admin-demo, client-demo, ingenieur-demo) sur la base Supabase PREVIEW
// UNIQUEMENT. Documentation complète : docs/RESET_COMPTES_DEMO_PREVIEW.md.
//
// Par défaut : PRÉCONTRÔLE SEUL (lecture seule, aucune écriture).
// Écriture uniquement avec l'argument --appliquer.
//
// Variables d'environnement (jamais affichées ni journalisées) :
//   DATABASE_URL               connexion à la base Preview
//   ATLAS_CONFIRMER_CIBLE      doit valoir la référence du projet Preview
//   DEMO_RESET_MDP_ADMIN       nouveau mot de passe admin-demo
//   DEMO_RESET_MDP_CLIENT      nouveau mot de passe client-demo
//   DEMO_RESET_MDP_INGENIEUR   nouveau mot de passe ingenieur-demo
//
// Usage : npx tsx scripts/reinitialiser-comptes-demo.ts [--appliquer]

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  COMPTES_DEMO,
  COUT_BCRYPT,
  lireMotsDePasse,
  precontrolerComptes,
  verifierCiblePreview,
  type EtatCompte,
} from "../lib/demo-reset";

const SELECTION_ETAT = {
  id: true,
  email: true,
  role: true,
  actif: true,
  emailVerifie: true,
  desactive: true,
  totpActif: true,
} as const;

function arreter(message: string): never {
  console.error(`REFUS — ${message}`);
  console.error("Aucune écriture n'a été effectuée.");
  process.exit(1);
}

async function main() {
  const appliquer = process.argv.includes("--appliquer");
  const argsInconnus = process.argv.slice(2).filter((a) => a !== "--appliquer");
  if (argsInconnus.length > 0) arreter("argument(s) inconnu(s). Seul --appliquer est accepté.");

  // 1. Cible : trois contrôles indépendants, avant toute connexion.
  const cible = verifierCiblePreview({
    urlBase: process.env.DATABASE_URL,
    confirmation: process.env.ATLAS_CONFIRMER_CIBLE,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (!cible.ok) arreter(cible.raison);
  console.log("Cible : projet Supabase Preview confirmé (référence et empreinte concordantes).");

  // 2. Mots de passe : présence et longueur, sans jamais les afficher.
  const mdp = lireMotsDePasse(process.env);
  if (!mdp.ok) arreter(mdp.raison);
  const motsDePasse = mdp.motsDePasse;
  console.log(`Mots de passe : ${COMPTES_DEMO.length} valeurs fournies (non affichées).`);

  // Le client est construit avec l'URL qui vient d'être vérifiée, et elle seule.
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  const emails = COMPTES_DEMO.map((c) => c.email);

  try {
    // 3. Précontrôle complet en lecture seule.
    const etat: EtatCompte[] = await prisma.user.findMany({ where: { email: { in: emails } }, select: SELECTION_ETAT });
    const pre = precontrolerComptes(etat);
    if (!pre.ok) arreter(`précontrôle : ${pre.raison}`);
    console.log("Précontrôle : 3 comptes trouvés, rôles corrects, actifs, email confirmé, non désactivés, sans 2FA.");

    if (!appliquer) {
      console.log("Mode précontrôle seul : aucune écriture. Relancer avec --appliquer pour réinitialiser.");
      return;
    }

    // 4. Hashage hors transaction (bcrypt coût 12 = méthode de l'application).
    const hashes = new Map<string, string>();
    for (const compte of COMPTES_DEMO) {
      hashes.set(compte.email, await bcrypt.hash(motsDePasse.get(compte.email)!, COUT_BCRYPT));
    }

    // 5. Transaction atomique : relecture, mise à jour ciblée, vérification.
    //    Toute anomalie lève une erreur -> annulation complète.
    await prisma.$transaction(
      async (tx) => {
        const relu: EtatCompte[] = await tx.user.findMany({ where: { email: { in: emails } }, select: SELECTION_ETAT });
        const recheck = precontrolerComptes(relu);
        if (!recheck.ok) throw new Error(`état modifié depuis le précontrôle : ${recheck.raison}`);

        for (const compte of COMPTES_DEMO) {
          const ligne = relu.find((l) => l.email === compte.email)!;
          const { count } = await tx.user.updateMany({
            where: { id: ligne.id, email: compte.email, role: compte.role, actif: true },
            data: { passwordHash: hashes.get(compte.email)!, echecsConnexion: 0, verrouilleJusqua: null },
          });
          if (count !== 1) throw new Error(`${compte.email} : ${count} ligne(s) mise(s) à jour au lieu de 1.`);
        }

        // Vérification avant validation : le hash enregistré accepte bien le
        // nouveau mot de passe avec bcrypt.compare (méthode de la connexion).
        const apres = await tx.user.findMany({
          where: { email: { in: emails } },
          select: { email: true, passwordHash: true, echecsConnexion: true, verrouilleJusqua: true },
        });
        for (const compte of COMPTES_DEMO) {
          const l = apres.find((a) => a.email === compte.email);
          if (!l) throw new Error(`${compte.email} : introuvable après mise à jour.`);
          const valide = await bcrypt.compare(motsDePasse.get(compte.email)!, l.passwordHash);
          if (!valide || l.echecsConnexion !== 0 || l.verrouilleJusqua !== null) {
            throw new Error(`${compte.email} : vérification après mise à jour échouée.`);
          }
        }
      },
      { isolationLevel: "Serializable", timeout: 30_000 }
    );

    for (const compte of COMPTES_DEMO) {
      console.log(`OK — ${compte.email} (${compte.role}) : mot de passe réinitialisé, compteur d'échecs remis à 0.`);
    }
  } catch (erreur) {
    // Message court uniquement : jamais l'URL, jamais de stack Prisma complète.
    const e = erreur as { name?: string; code?: string; message?: string };
    const resume = e?.code ? `${e.name ?? "Error"}(${e.code})` : e?.name ?? "Error";
    // Les messages Prisma peuvent contenir l'hôte de la base : jamais affichés.
    const estPrisma = typeof e?.name === "string" && e.name.startsWith("Prisma");
    const message = !estPrisma && typeof e?.message === "string" && !/postgres(ql)?:\/\//.test(e.message) ? e.message.slice(0, 300) : "";
    arreter(`échec, transaction annulée : ${resume}${message ? ` — ${message}` : ""}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
