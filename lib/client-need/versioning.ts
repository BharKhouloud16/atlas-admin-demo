import { Prisma } from "@prisma/client";
import type { ClientNeed, ClientNeedFait, ClientNeedStatut, NeedLifecycleStatut, ClientNeedCoherenceStatut, ClientNeedFaitCle } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resoudreFaitsActifsPourCopie } from "./faits";

// A5.2 — ATLAS FUNCTIONAL SPECIFICATION vFINAL (30/09/2026) : Need
// Versioning Core. Implémente exactement le socle verrouillé par le gate
// "A5.1 — FINAL ARCHITECTURE DECISION" : copie physique des faits ACTIVE
// (jamais une résolution récursive entre versions, jamais de
// `parent -> parent -> parent`), fork atomique, chaîne linéaire.
//
// EXPLICITEMENT HORS PÉRIMÈTRE (décision A5.1 non prise, gate A5.2) : la
// suppression ou le remplacement ciblé d'une instance précise d'une clé
// répétable. Ce module ne l'implémente jamais — voir
// resoudreFaitsActifsPourCopie (lib/client-need/faits.ts), qui copie
// TOUJOURS l'intégralité des instances répétables actives, jamais une
// omission silencieuse.

// Version courante ⇔ needSuivantId IS NULL (gate A5.1 §20) — jamais
// MAX(version) seul, jamais de table de lignage séparée.
export function estVersionCourante(need: { needSuivantId: string | null }): boolean {
  return need.needSuivantId === null;
}

// Levée quand une opération d'écriture (fork, PATCH, POST fait) vise une
// version qui n'est plus courante — soit parce qu'elle était déjà
// historique au moment de la requête, soit parce qu'un fork concurrent
// s'est intercalé entre la lecture de l'appelant et cette transaction
// (relecture défensive à l'intérieur de la transaction Serializable,
// gate A5.1 §21). Les routes appelantes traduisent ceci en HTTP 409,
// jamais un silence ni une écriture acceptée sur une base obsolète.
export class VersionNonCouranteError extends Error {
  constructor() {
    super("VERSION_NON_COURANTE");
  }
}

export type NeedAvecFaits = ClientNeed & { faits: ClientNeedFait[] };

export type ChangementsFork = {
  // `undefined` = inchangé (hérité de la version source) ; `null` est une
  // valeur valide distincte pour `titre` (déjà le cas aujourd'hui côté
  // PATCH existant).
  titre?: string | null;
  statut?: ClientNeedStatut;
  lifecycleStatut?: NeedLifecycleStatut;
  coherenceStatut?: ClientNeedCoherenceStatut;
  coherenceDetail?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  // Un seul nouveau fait par fork (le périmètre réel aujourd'hui : POST
  // .../faits ne traite jamais plus d'une clé par appel). Toujours une
  // clé NON répétable en pratique (CLES_CLARIFIABLES l'impose déjà côté
  // route) — jamais vérifié à nouveau ici, la responsabilité reste à
  // l'appelant, ce module ne fait que copier/forker.
  nouveauFait?: { cle: ClientNeedFaitCle; valeur: string; statut: string; source: string };
};

// Fork atomique Vn -> V(n+1) — à appeler EXCLUSIVEMENT depuis l'intérieur
// d'une transaction Serializable (voir executerForkAvecRetry ci-dessous).
// Relit Vn dans la MÊME transaction avant toute écriture : si un autre
// fork a déjà eu lieu entre la lecture initiale de l'appelant et cet
// appel, needSuivantId ne sera plus NULL et l'opération est refusée
// immédiatement (VersionNonCouranteError), jamais une double branche.
export async function forkerVersion(
  tx: Prisma.TransactionClient,
  vn: NeedAvecFaits,
  changements: ChangementsFork
): Promise<NeedAvecFaits> {
  const actuel = await tx.clientNeed.findUnique({ where: { id: vn.id } });
  if (!actuel) throw new Error("BESOIN_INTROUVABLE");
  if (!estVersionCourante(actuel)) throw new VersionNonCouranteError();

  // Jamais les deux valeurs de la même clé (la copie ET le nouveau fait)
  // dans V(n+1) — élimine toute ambiguïté d'ordre de création plutôt que
  // de s'appuyer sur `createdAt` pour les départager (gate A5.2, choix
  // d'implémentation délibéré pour la déterminisme, voir rapport final).
  const faitsACopier = resoudreFaitsActifsPourCopie(vn.faits).filter(
    (f) => !changements.nouveauFait || f.cle !== changements.nouveauFait.cle
  );

  const suivant = await tx.clientNeed.create({
    data: {
      clientId: vn.clientId,
      correlationId: vn.correlationId,
      texteOriginal: vn.texteOriginal,
      titre: changements.titre !== undefined ? changements.titre : vn.titre,
      statut: changements.statut ?? vn.statut,
      lifecycleStatut: changements.lifecycleStatut ?? vn.lifecycleStatut,
      coherenceStatut: changements.coherenceStatut ?? vn.coherenceStatut,
      coherenceDetail:
        changements.coherenceDetail !== undefined ? changements.coherenceDetail : ((vn.coherenceDetail ?? Prisma.JsonNull) as Prisma.InputJsonValue),
      analyseProvider: vn.analyseProvider,
      analyseeLe: vn.analyseeLe,
      version: vn.version + 1,
      needParentId: vn.id,
      needSuivantId: null,
      faits: {
        create: [
          ...faitsACopier.map((f) => ({
            cle: f.cle as ClientNeedFaitCle,
            valeur: f.valeur,
            statut: f.statut as ClientNeedFait["statut"],
            source: (f as unknown as ClientNeedFait).source,
            statutActivite: "ACTIVE" as const,
          })),
          ...(changements.nouveauFait
            ? [
                {
                  cle: changements.nouveauFait.cle,
                  valeur: changements.nouveauFait.valeur,
                  statut: changements.nouveauFait.statut as ClientNeedFait["statut"],
                  source: changements.nouveauFait.source,
                  statutActivite: "ACTIVE" as const,
                },
              ]
            : []),
        ],
      },
    },
    include: { faits: true },
  });

  // Vn ne reçoit plus jamais aucune autre écriture après cette ligne —
  // seul champ qui change sur la version devenue historique.
  await tx.clientNeed.update({ where: { id: vn.id }, data: { needSuivantId: suivant.id } });

  return suivant;
}

const MAX_TENTATIVES_FORK = 3;

// Même discipline que lib/client-solution/generation.ts
// (genererOuRecupererSolutions) : transaction Serializable, nouvelle
// tentative sur conflit de sérialisation Postgres (P2034) — jamais sur
// VersionNonCouranteError, qui signifie que la version visée est
// réellement devenue historique (retenter ne changerait rien, l'appelant
// doit recevoir 409 immédiatement).
export async function executerForkAvecRetry<T>(executer: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let tentative = 0; tentative < MAX_TENTATIVES_FORK; tentative++) {
    try {
      return await prisma.$transaction(executer, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES_FORK - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_FORK_CONCURRENCE");
}
