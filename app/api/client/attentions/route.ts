import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { Attention } from "@prisma/client";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";
import { comparerAttentions } from "@/lib/attention/generateurs";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// API Client.
//
// clientId dérivé EXCLUSIVEMENT de session.clientId, jamais accepté depuis
// la requête (même discipline que /api/client/besoins, /api/client/profil,
// /api/client/messages). La synchronisation est déclenchée ICI, à chaque
// lecture — aucune tâche planifiée n'existe dans ce dépôt (voir
// lib/billing/etat-facture.ts), donc c'est le seul moment où l'état peut
// être recalculé depuis Billing/ClientNeed.
//
// Pagination (mandat CEO V2.3 section 17 : "findMany non paginés" cité
// explicitement comme risque) — `limit`/`offset`, jamais un chargement
// complet non borné pour un historique qui grandit indéfiniment.
const LIMITE_PAR_DEFAUT = 20;
const LIMITE_MAX = 100;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  await synchroniserAttentionsClient(session.clientId);

  const url = new URL(req.url);
  const historique = url.searchParams.get("historique") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || LIMITE_PAR_DEFAUT, 1), LIMITE_MAX);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const [attentions, nonLues] = await Promise.all([
    prisma.attention.findMany({
      where: {
        recipientType: "CLIENT",
        recipientId: session.clientId,
        ...(historique ? {} : { statut: { in: ["OUVERTE", "LUE"] } }),
      },
    }),
    prisma.attention.count({ where: { recipientType: "CLIENT", recipientId: session.clientId, statut: "OUVERTE" } }),
  ]);

  const triees = attentions.sort(comparerAttentions);
  const page = triees.slice(offset, offset + limit);

  return NextResponse.json({
    attentions: page.map(adapterAttentionClient),
    total: triees.length,
    nonLues,
  });
}

function adapterAttentionClient(a: Attention) {
  return {
    id: a.id,
    type: a.type,
    categorie: a.categorie,
    priorite: a.priorite,
    titre: a.titre,
    resume: a.resume,
    raison: a.raison,
    statut: a.statut,
    actionDisponible: a.actionDisponible,
    metadata: a.metadata,
    createdAt: a.createdAt.toISOString(),
    readAt: a.readAt ? a.readAt.toISOString() : null,
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
  };
}
