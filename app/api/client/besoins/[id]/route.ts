import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ClientNeedStatut } from "@prisma/client";

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Même discipline d'isolation que le reste de l'Espace Client : l'id de
// l'URL sélectionne UNIQUEMENT quel enregistrement lire/modifier/supprimer
// — jamais quel client. Chaque opération revérifie explicitement
// `besoin.clientId === session.clientId` avant d'agir ; un besoin
// appartenant à un autre client renvoie 404, jamais une fuite d'existence
// (même principe que /api/evaluations, /api/feuilles-de-temps).
//
// PATCH est volontairement limité à `titre`/`statut` (métadonnées du
// besoin) — la correction/validation des FAITS individuels (INFERE ->
// VERIFIE, correction de valeur) est explicitement HORS PÉRIMÈTRE de ce
// lot (directive CEO, autorisation d'implémentation LOT 2).

// A_CLARIFIER volontairement absent : ce statut est exclusivement piloté
// par le serveur (lib/client-need/clarification.ts, LOT 3) — le client ne
// doit jamais pouvoir le forcer directement (décision CEO LOT 3).
const STATUTS_MODIFIABLES_PAR_CLIENT = new Set(["SOUMIS", "VALIDE", "ARCHIVE"]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({
    where: { id: params.id },
    include: { faits: true },
  });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  return NextResponse.json({ besoin });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({ where: { id: params.id } });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { titre?: string | null; statut?: ClientNeedStatut } = {};

  if (body?.titre !== undefined) {
    if (body.titre !== null && (typeof body.titre !== "string" || body.titre.trim().length === 0)) {
      return NextResponse.json({ error: "titre invalide." }, { status: 400 });
    }
    data.titre = body.titre === null ? null : body.titre.trim().slice(0, 200);
  }

  if (body?.statut !== undefined) {
    if (typeof body.statut !== "string" || !STATUTS_MODIFIABLES_PAR_CLIENT.has(body.statut)) {
      return NextResponse.json(
        { error: "statut invalide. BROUILLON et A_CLARIFIER ne sont jamais modifiables directement par le client." },
        { status: 400 }
      );
    }
    data.statut = body.statut as ClientNeedStatut;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucune modification fournie." }, { status: 400 });
  }

  const misAJour = await prisma.clientNeed.update({
    where: { id: params.id },
    data,
    include: { faits: true },
  });

  return NextResponse.json({ besoin: misAJour });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({ where: { id: params.id } });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  // onDelete: Cascade (ClientNeedFait -> ClientNeed) — les faits associés
  // sont supprimés avec le besoin, aucune ligne orpheline.
  await prisma.clientNeed.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
