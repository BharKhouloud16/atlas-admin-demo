import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 1 — Read State,
// 21/09/2026).
//
// Message reste append-only (règle non négociable #3/#4 du mandat) : aucun
// champ readAt/isRead n'existe sur Message. L'état de lecture vit
// EXCLUSIVEMENT dans MessageLecture, un curseur par (clientId, userId) —
// userId est TOUJOURS le User.id réel de l'appelant authentifié (jamais un
// sentinel de rôle), ce qui permet à chaque Admin d'avoir son propre
// curseur (règle #7) sans qu'un curseur Client (règle #6) ne s'en
// distingue structurellement : les deux cas sont le même modèle, seule
// l'identité du userId change.

export async function marquerFilLu(clientId: string, userId: string, maintenant: Date = new Date()) {
  return prisma.messageLecture.upsert({
    where: { clientId_userId: { clientId, userId } },
    update: { dernierLuLe: maintenant },
    create: { clientId, userId, dernierLuLe: maintenant },
  });
}

// Nombre de messages non lus pour un lecteur donné : messages du CÔTÉ
// OPPOSÉ (celui que ce lecteur n'a pas lui-même écrit) postérieurs à son
// curseur. Un lecteur qui n'a encore aucun curseur (jamais ouvert le fil)
// voit tous les messages du côté opposé comme non lus.
export async function compterMessagesNonLus(clientId: string, userId: string, auteurOppose: "CLIENT" | "ADMIN"): Promise<number> {
  const curseur = await prisma.messageLecture.findUnique({ where: { clientId_userId: { clientId, userId } } });
  return prisma.message.count({
    where: {
      clientId,
      auteurRole: auteurOppose,
      ...(curseur ? { createdAt: { gt: curseur.dernierLuLe } } : {}),
    },
  });
}

// V2.5 — Communication Intelligence (Lot 5, 21/09/2026) : ensemble des
// clientId dont le fil est non lu pour CET Admin (règle #7 — individuel),
// utilisé pour le badge par ligne de app/admin/clients/page.tsx. Bornée à 2
// requêtes DB, jamais une requête par Client (même discipline que
// lib/attention/synchronisation.ts) : (1) dernier message CLIENT par
// clientId, (2) tous les curseurs de CET Admin — le calcul "non lu" reste
// ensuite en mémoire.
export async function clientsAvecMessagesNonLusPourAdmin(userId: string): Promise<Set<string>> {
  const [derniersMessagesClient, curseurs] = await Promise.all([
    prisma.message.groupBy({ by: ["clientId"], where: { auteurRole: "CLIENT" }, _max: { createdAt: true } }),
    prisma.messageLecture.findMany({ where: { userId }, select: { clientId: true, dernierLuLe: true } }),
  ]);

  const curseurParClient = new Map(curseurs.map((c) => [c.clientId, c.dernierLuLe]));
  const nonLus = new Set<string>();
  for (const g of derniersMessagesClient) {
    if (!g._max.createdAt) continue;
    const curseur = curseurParClient.get(g.clientId);
    if (!curseur || g._max.createdAt > curseur) nonLus.add(g.clientId);
  }
  return nonLus;
}
