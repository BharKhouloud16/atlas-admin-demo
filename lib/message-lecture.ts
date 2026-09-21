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
