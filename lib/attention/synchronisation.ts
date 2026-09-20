import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { Facture, Paiement, ClientNeed, AttentionType, Attention } from "@prisma/client";
import {
  genererCandidatsFacture,
  genererCandidatAnomalie,
  genererCandidatBesoin,
  TYPES_ATTENTION_FACTURE,
  TYPES_ATTENTION_BESOIN,
  type AttentionCandidat,
} from "./generateurs";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center.
//
// Seul point du domaine Attention qui touche la base — les fonctions de
// lib/attention/generateurs.ts restent pures. Aucune tâche planifiée
// n'existe dans ce dépôt (voir lib/billing/etat-facture.ts) : la
// synchronisation est donc TOUJOURS déclenchée à la lecture, par les routes
// API (GET /api/client/attentions, GET /api/admin/attentions), jamais par
// un cron. Idempotente par construction : rejouer la même entrée produit
// exactement le même état (upsert sur la clé (type, source, sourceId)),
// jamais une nouvelle ligne.
//
// PERFORMANCE (mandat CEO V2.3 section 17) : une première version faisait
// un aller-retour DB par candidat (findUnique puis create/update) — mesurée
// contre l'état réel de ce dépôt (387 Facture + 560 ClientNeed accumulées
// sur cette session), elle dépassait le timeout de test. Réécrit en 3
// requêtes au total par appel, quel que soit le nombre d'entités : UN
// findMany groupé pour lire l'existant, UN createMany pour les nouvelles
// lignes, UNE transaction batchée pour les mises à jour — jamais un
// aller-retour par entité.

type FactureAvecPaiements = Facture & { paiements: Paiement[] };

type EntiteASynchroniser = { candidats: AttentionCandidat[]; source: string; sourceId: string; typesPossibles: AttentionType[] };

function entiteFacture(facture: FactureAvecPaiements, maintenant: Date): EntiteASynchroniser {
  const candidatsClient = genererCandidatsFacture(facture, maintenant);
  const candidatAnomalie = genererCandidatAnomalie(facture);
  return {
    candidats: candidatAnomalie ? [...candidatsClient, candidatAnomalie] : candidatsClient,
    source: "Facture",
    sourceId: facture.id,
    typesPossibles: TYPES_ATTENTION_FACTURE,
  };
}

function entiteBesoin(besoin: ClientNeed): EntiteASynchroniser {
  const candidat = genererCandidatBesoin(besoin);
  return {
    candidats: candidat ? [candidat] : [],
    source: "ClientNeed",
    sourceId: besoin.id,
    typesPossibles: TYPES_ATTENTION_BESOIN,
  };
}

function cle(type: string, source: string, sourceId: string): string {
  return `${type}|${source}|${sourceId}`;
}

// Cœur unique de la synchronisation — utilisé par les 3 chemins publics
// ci-dessous (Client scopé, Admin global). `entites` peut représenter un
// seul Client ou l'intégralité du dépôt : le coût reste borné (3 requêtes)
// quel que soit son volume.
async function synchroniserEntites(entites: EntiteASynchroniser[], maintenant: Date): Promise<void> {
  if (entites.length === 0) return;

  const idsParSource = new Map<string, string[]>();
  for (const e of entites) {
    const liste = idsParSource.get(e.source) ?? [];
    liste.push(e.sourceId);
    idsParSource.set(e.source, liste);
  }

  const existantes = await prisma.attention.findMany({
    where: { OR: Array.from(idsParSource.entries()).map(([source, sourceIds]) => ({ source, sourceId: { in: sourceIds } })) },
  });
  const existantesParCle = new Map<string, Attention>(existantes.map((a) => [cle(a.type, a.source, a.sourceId), a]));

  const aCreer: Prisma.AttentionCreateManyInput[] = [];
  const aMettreAJour: { id: string; data: Prisma.AttentionUpdateInput }[] = [];
  const idsAResoudre: string[] = [];

  for (const entite of entites) {
    const typesActifs = new Set(entite.candidats.map((c) => c.type));

    for (const c of entite.candidats) {
      const existante = existantesParCle.get(cle(c.type, c.source, c.sourceId));
      if (!existante) {
        aCreer.push({
          type: c.type,
          categorie: c.categorie,
          priorite: c.priorite,
          titre: c.titre,
          resume: c.resume,
          raison: c.raison,
          source: c.source,
          sourceId: c.sourceId,
          recipientType: c.recipientType,
          recipientId: c.recipientId,
          actionDisponible: (c.actionDisponible ?? undefined) as Prisma.InputJsonValue | undefined,
          metadata: (c.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          expiresAt: c.expiresAt,
        });
        continue;
      }
      // Une Attention déjà RESOLUE/EXPIREE dont le fait redevient vrai (ex.
      // une facture ré-échue après une nouvelle échéance) doit se réouvrir —
      // jamais rester figée sur un statut obsolète.
      const doitReouvrir = existante.statut === "RESOLUE" || existante.statut === "EXPIREE";
      aMettreAJour.push({
        id: existante.id,
        data: {
          titre: c.titre,
          resume: c.resume,
          raison: c.raison,
          categorie: c.categorie,
          priorite: c.priorite,
          actionDisponible: (c.actionDisponible ?? undefined) as Prisma.InputJsonValue | undefined,
          metadata: (c.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          expiresAt: c.expiresAt,
          ...(doitReouvrir ? { statut: "OUVERTE" as const, readAt: null, resolvedAt: null } : {}),
        },
      });
    }

    // Résolution : tout type possible pour cette entité mais non produit
    // par ce passage (le fait métier ne s'applique plus) et encore
    // OUVERTE/LUE en base doit être marqué RESOLUE.
    for (const type of entite.typesPossibles) {
      if (typesActifs.has(type)) continue;
      const existante = existantesParCle.get(cle(type, entite.source, entite.sourceId));
      if (existante && (existante.statut === "OUVERTE" || existante.statut === "LUE")) {
        idsAResoudre.push(existante.id);
      }
    }
  }

  if (aCreer.length > 0) {
    // skipDuplicates : deux synchronisations concurrentes du même fait
    // (même clé (type, source, sourceId)) peuvent toutes deux constater son
    // absence puis tenter de la créer — la seconde ne doit jamais crasher
    // sur la contrainte d'unicité, seulement être ignorée (la ligne existe
    // déjà, créée par la première).
    await prisma.attention.createMany({ data: aCreer, skipDuplicates: true });
  }
  if (aMettreAJour.length > 0) {
    await prisma.$transaction(aMettreAJour.map((u) => prisma.attention.update({ where: { id: u.id }, data: u.data })));
  }
  if (idsAResoudre.length > 0) {
    await prisma.attention.updateMany({ where: { id: { in: idsAResoudre } }, data: { statut: "RESOLUE", resolvedAt: maintenant } });
  }
}

async function expirerLignesDepassees(portee: { recipientType: "CLIENT" | "ADMIN"; recipientId: string | null } | null, maintenant: Date) {
  await prisma.attention.updateMany({
    where: {
      ...(portee ?? {}),
      statut: { in: ["OUVERTE", "LUE"] },
      expiresAt: { lt: maintenant },
    },
    data: { statut: "EXPIREE" },
  });
}

// Synchronise l'ensemble des Attention CLIENT d'un client donné — toujours
// scopé (jamais un balayage global depuis une route Client, voir
// app/api/client/attentions/route.ts).
export async function synchroniserAttentionsClient(clientId: string, maintenant: Date = new Date()): Promise<void> {
  const [factures, besoins] = await Promise.all([
    prisma.facture.findMany({ where: { clientId }, include: { paiements: true } }),
    prisma.clientNeed.findMany({ where: { clientId } }),
  ]);

  await synchroniserEntites([...factures.map((f) => entiteFacture(f, maintenant)), ...besoins.map(entiteBesoin)], maintenant);
  await expirerLignesDepassees({ recipientType: "CLIENT", recipientId: clientId }, maintenant);
}

// Synchronise TOUTES les Attention (tous Clients + Admin) — chemin Admin
// uniquement (mandat CEO V2.3 section 13 : Admin voit "attentions,
// notifications... anomalies" à travers tous les Clients, filtrable par
// Client/Type/Priorité/Statut/Date/Source). La LECTURE des sources reste
// un balayage complet non paginé (même pattern que GET /api/factures déjà
// existant côté Admin) — mais l'ÉCRITURE est batchée (voir
// synchroniserEntites ci-dessus), jamais un aller-retour par Facture.
export async function synchroniserAttentionsGlobal(maintenant: Date = new Date()): Promise<void> {
  const [factures, besoins] = await Promise.all([
    prisma.facture.findMany({ include: { paiements: true } }),
    prisma.clientNeed.findMany(),
  ]);

  await synchroniserEntites([...factures.map((f) => entiteFacture(f, maintenant)), ...besoins.map(entiteBesoin)], maintenant);
  await expirerLignesDepassees(null, maintenant);
}
