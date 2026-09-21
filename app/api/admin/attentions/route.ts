import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AttentionType, AttentionPriorite, AttentionStatut, type Prisma } from "@prisma/client";
import { synchroniserAttentionsGlobal } from "@/lib/attention/synchronisation";
import { comparerAttentions } from "@/lib/attention/generateurs";
import { resoudreUserId } from "@/lib/session-user";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// API Admin.
//
// Réservé ADMIN — jamais l'Ingénieur (même défense en profondeur que
// /api/factures, /api/clients/[id]/messages). Voit TOUTES les Attention
// (tous Clients + Admin), avec les filtres explicitement demandés par le
// mandat CEO V2.3 section 13 : Client, Type, Priorité, Statut, Date,
// Source — jamais un filtre supplémentaire inventé.
//
// Pagination (section 17) — même discipline que GET /api/client/attentions.
const LIMITE_PAR_DEFAUT = 20;
const LIMITE_MAX = 100;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  await synchroniserAttentionsGlobal();

  const url = new URL(req.url);
  const historique = url.searchParams.get("historique") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || LIMITE_PAR_DEFAUT, 1), LIMITE_MAX);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const clientId = url.searchParams.get("clientId");
  const type = url.searchParams.get("type");
  const priorite = url.searchParams.get("priorite");
  const statutFiltre = url.searchParams.get("statut");
  const source = url.searchParams.get("source");
  const depuis = url.searchParams.get("depuis");

  const typeValide = type && (Object.values(AttentionType) as string[]).includes(type) ? (type as AttentionType) : null;
  const prioriteValide = priorite && (Object.values(AttentionPriorite) as string[]).includes(priorite) ? (priorite as AttentionPriorite) : null;
  const statutValide = statutFiltre && (Object.values(AttentionStatut) as string[]).includes(statutFiltre) ? (statutFiltre as AttentionStatut) : null;
  const depuisValide = depuis && !Number.isNaN(new Date(depuis).getTime()) ? new Date(depuis) : null;

  // Le filtre "Client" doit montrer TOUT ce qui concerne ce Client — y
  // compris une ANOMALIE_FINANCIERE (recipientType=ADMIN, recipientId=null,
  // jamais scopée à un Client) portant sur UNE de ses Facture. `recipientId`
  // seul ne suffit donc pas : on résout aussi les Facture/ClientNeed de ce
  // Client pour matcher par `sourceId`, jamais par une seconde copie du
  // clientId sur Attention (qui dupliquerait Facture.clientId — voir
  // lib/attention/synchronisation.ts, "l'Attention Center n'est jamais une
  // nouvelle source de vérité métier").
  let clientFilter: Prisma.AttentionWhereInput | null = null;
  if (clientId) {
    const [factures, besoins] = await Promise.all([
      prisma.facture.findMany({ where: { clientId }, select: { id: true } }),
      prisma.clientNeed.findMany({ where: { clientId }, select: { id: true } }),
    ]);
    const sourceIds = [...factures.map((f) => f.id), ...besoins.map((b) => b.id)];
    clientFilter = {
      OR: [
        { recipientType: "CLIENT", recipientId: clientId },
        ...(sourceIds.length ? [{ sourceId: { in: sourceIds } }] : []),
        // V2.5 — Communication Intelligence (Lot 2) : MESSAGE_NON_LU côté
        // ADMIN a un sourceId qualifié par lecteur ("clientId:adminUserId",
        // voir lib/attention/generateurs.ts) — jamais un simple sourceId
        // égal au clientId comme Facture/ClientNeed, donc jamais matché par
        // le `in: sourceIds` ci-dessus. startsWith reste sûr : aucun autre
        // `source` n'utilise ce format de sourceId composite.
        { source: "Message", sourceId: clientId },
        { source: "Message", sourceId: { startsWith: `${clientId}:` } },
      ],
    };
  }

  // V2.5 — Communication Intelligence (Lot 2, 21/09/2026) : MESSAGE_NON_LU
  // introduit les premières Attention ADMIN à recipientId non-null
  // (individuelles, règle #7 — un curseur/signal propre à CET Admin,
  // jamais partagé). Avant V2.5, recipientId était toujours null côté
  // ADMIN (ANOMALIE_FINANCIERE, globale) — cette liste n'avait donc jamais
  // besoin de filtrer par identité de l'Admin connecté. Combiné en AND
  // (jamais un spread OR, qui écraserait celui de clientFilter ci-dessus)
  // pour ne jamais élargir la portée des autres filtres.
  const userId = await resoudreUserId(session.email);
  const visibiliteAdmin: Prisma.AttentionWhereInput = {
    OR: [{ recipientType: "CLIENT" }, { recipientType: "ADMIN", recipientId: null }, ...(userId ? [{ recipientType: "ADMIN" as const, recipientId: userId }] : [])],
  };

  const conditions: Prisma.AttentionWhereInput[] = [visibiliteAdmin];
  if (!historique) conditions.push({ statut: { in: ["OUVERTE", "LUE"] } });
  if (clientFilter) conditions.push(clientFilter);
  if (typeValide) conditions.push({ type: typeValide });
  if (prioriteValide) conditions.push({ priorite: prioriteValide });
  if (statutValide) conditions.push({ statut: statutValide });
  if (source) conditions.push({ source });
  if (depuisValide) conditions.push({ createdAt: { gte: depuisValide } });

  const where: Prisma.AttentionWhereInput = { AND: conditions };

  const attentions = await prisma.attention.findMany({ where });
  const triees = attentions.sort(comparerAttentions);
  const page = triees.slice(offset, offset + limit);

  const clientIds = Array.from(new Set(page.filter((a) => a.recipientType === "CLIENT" && a.recipientId).map((a) => a.recipientId as string)));
  const clients = clientIds.length
    ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, nom: true } })
    : [];
  const nomParClientId = new Map(clients.map((c) => [c.id, c.nom]));

  return NextResponse.json({
    attentions: page.map((a) => ({
      id: a.id,
      type: a.type,
      categorie: a.categorie,
      priorite: a.priorite,
      titre: a.titre,
      resume: a.resume,
      raison: a.raison,
      statut: a.statut,
      source: a.source,
      sourceId: a.sourceId,
      recipientType: a.recipientType,
      clientId: a.recipientType === "CLIENT" ? a.recipientId : null,
      clientNom: a.recipientType === "CLIENT" && a.recipientId ? nomParClientId.get(a.recipientId) ?? null : null,
      actionDisponible: a.actionDisponible,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
      readAt: a.readAt ? a.readAt.toISOString() : null,
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    })),
    total: triees.length,
    nonLues: attentions.filter((a) => a.statut === "OUVERTE").length,
  });
}
