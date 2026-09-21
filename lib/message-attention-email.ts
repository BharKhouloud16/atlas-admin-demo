import { prisma } from "@/lib/prisma";
import type { AttentionCategorie, AttentionDestinataireType } from "@prisma/client";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";
import { lirePreferenceNotification } from "@/lib/preference-notification";
import { envoyerEmailMessageNonLu } from "@/lib/email";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 4 — Email
// transactionnel, 21/09/2026).
//
// Réutilise lib/email.ts (règle #13) et synchroniserAttentionsClient
// (règle #2 — aucune nouvelle synchronisation) : ce fichier n'ajoute
// AUCUN nouveau chemin d'écriture, seulement un diff avant/après autour de
// l'appel de synchronisation déjà existant, pour détecter une transition
// RÉELLE vers "non lu" (création OU réouverture après résolution) sans
// jamais modifier synchroniserEntites (moteur partagé par Facture/
// ClientNeed/Message — voir lib/attention/synchronisation.ts).
//
// Pourquoi un diff avant/après plutôt que createdAt===updatedAt : une
// Attention déjà OUVERTE est re-synchronisée (mêmes données, updatedAt
// avancé) à chaque lecture du thread — un simple test createdAt===
// updatedAt raterait toute RÉOUVERTURE après résolution (Client relit tout,
// puis un nouveau message arrive). Le diff "n'était pas OUVERTE avant, l'est
// après" capture les deux cas (première ouverture et réouverture) et ne
// capture jamais un message supplémentaire sur un fil déjà non lu (mandat :
// "éviter un email à chaque message") puisque la ligne reste alors OUVERTE
// des deux côtés du diff.
async function messageNonLuOuvertesDuThread(clientId: string) {
  return prisma.attention.findMany({
    where: {
      type: "MESSAGE_NON_LU",
      source: "Message",
      statut: "OUVERTE",
      OR: [{ sourceId: clientId }, { sourceId: { startsWith: `${clientId}:` } }],
    },
    select: { id: true, recipientType: true, recipientId: true, categorie: true },
  });
}

const BASE_URL = process.env.EMAIL_APP_BASE_URL || "https://atlas-admin-demo.vercel.app";

async function notifierDestinataire(
  clientId: string,
  attention: { recipientType: AttentionDestinataireType; recipientId: string | null; categorie: AttentionCategorie }
) {
  const compte =
    attention.recipientType === "CLIENT"
      ? await prisma.user.findFirst({ where: { role: "CLIENT", clientId }, select: { id: true, email: true } })
      : attention.recipientId
        ? await prisma.user.findUnique({ where: { id: attention.recipientId }, select: { id: true, email: true } })
        : null;
  if (!compte) return; // Client sans compte de connexion, ou recipientId incohérent -- personne à notifier.

  const preference = await lirePreferenceNotification(compte.id);
  if (!preference.emailActif || !preference.categoriesEmail.includes(attention.categorie)) return;

  const client = attention.recipientType === "CLIENT" ? await prisma.client.findUnique({ where: { id: clientId }, select: { nom: true } }) : null;
  const chemin = attention.recipientType === "CLIENT" ? "/client/communication" : `/admin/clients/${clientId}/messages`;

  await envoyerEmailMessageNonLu({ to: compte.email, nom: client?.nom, lien: `${BASE_URL}${chemin}` });
}

// Point d'entrée unique appelé depuis les routes POST Message (Client et
// Admin) à la place d'un appel direct à synchroniserAttentionsClient —
// même effet de synchronisation, plus la notification best-effort. Un
// échec d'envoi ne doit jamais faire échouer l'envoi du message
// (lib/email.ts est déjà best-effort ; ce fichier ne fait qu'orchestrer
// autour, jamais de throw propagé).
export async function synchroniserEtNotifierMessage(clientId: string, maintenant: Date = new Date()): Promise<void> {
  const avant = new Set((await messageNonLuOuvertesDuThread(clientId)).map((a) => a.id));

  await synchroniserAttentionsClient(clientId, maintenant);

  const apres = await messageNonLuOuvertesDuThread(clientId);
  const nouvellementOuvertes = apres.filter((a) => !avant.has(a.id));
  if (nouvellementOuvertes.length === 0) return;

  for (const attention of nouvellementOuvertes) {
    try {
      await notifierDestinataire(clientId, attention);
    } catch (e) {
      console.error(`[email:message-non-lu:erreur] clientId=${clientId} attentionId=${attention.id}`, e);
    }
  }
}
