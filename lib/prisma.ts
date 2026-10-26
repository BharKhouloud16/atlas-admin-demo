import { PrismaClient } from "@prisma/client";
import {
  BaseInterditeEnProduction,
  REQUETE_MARQUEUR,
  estAbsenceMarqueur,
  estProduction,
  refusCibleProduction,
  refusMarqueurProduction,
} from "@/lib/garde-base";

// Garde-fou Production / base Preview (voir lib/garde-base.ts) : en
// Production uniquement, la cible de connexion est contrôlée avant toute
// connexion (le build Production échoue déjà sur ce même contrôle, voir
// next.config.js), puis le marqueur de la base est lu au premier accès de
// chaque instance ; tant qu'il n'est pas validé, aucune requête de
// l'application n'est exécutée.
function creerClient(): PrismaClient {
  const refusCible = refusCibleProduction(process.env);
  if (refusCible) throw new BaseInterditeEnProduction(refusCible);

  const client = new PrismaClient();
  if (!estProduction(process.env)) return client;

  let verification: Promise<void> | null = null;
  const verifierMarqueur = () =>
    (verification ??= client
      .$queryRawUnsafe<{ nom: string }[]>(REQUETE_MARQUEUR)
      .then(
        (lignes) => lignes[0]?.nom ?? null,
        (erreur) => {
          if (estAbsenceMarqueur(erreur)) return null;
          verification = null; // erreur transitoire : nouvelle vérification au prochain accès
          throw erreur;
        }
      )
      .then((marqueur) => {
        const refus = refusMarqueurProduction(process.env, marqueur);
        if (refus) throw new BaseInterditeEnProduction(refus);
      }));

  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        await verifierMarqueur();
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}

// Évite de recréer une connexion à chaque hot-reload en développement
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? creerClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
