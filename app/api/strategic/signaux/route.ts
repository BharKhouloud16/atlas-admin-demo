import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enregistrerSignalStrategique } from "@/lib/strategic/veille";
import { estStrategicCategoryValide, STRATEGIC_SIGNAL_STATUTS, type StrategicSignalStatutValeur } from "@/lib/strategic/domain";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B21 (13/09/2026) : lecture/écriture des StrategicSignal
// (voir lib/strategic/veille.ts). Réservé ADMIN, même discipline que
// toutes les routes /api/security/* et /api/strategic/* — cette route ne
// figure pas dans middleware.ts, la protection est assurée ICI par
// getSession()+role (même pattern que app/api/security/rapports/route.ts,
// B18-FIX). Étape "Veille -> Signal" du cycle cible B21 : la saisie reste
// humaine (ADMIN), aucun scraping massif, aucun LLM autonome.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const categorie = searchParams.get("categorie") ?? undefined;
    const statut = searchParams.get("statut") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const signaux = await prisma.strategicSignal.findMany({
      where: {
        ...(categorie && estStrategicCategoryValide(categorie) ? { categorie } : {}),
        ...(statut && (STRATEGIC_SIGNAL_STATUTS as readonly string[]).includes(statut)
          ? { statut: statut as StrategicSignalStatutValeur }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ signaux });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des signaux stratégiques." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const categorie = body?.categorie;
    const source = body?.source;
    const titre = body?.titre;

    if (!estStrategicCategoryValide(categorie)) {
      return NextResponse.json({ error: "categorie invalide." }, { status: 400 });
    }
    if (typeof source !== "string" || source.trim().length === 0) {
      return NextResponse.json({ error: "source requise." }, { status: 400 });
    }
    if (typeof titre !== "string" || titre.trim().length === 0) {
      return NextResponse.json({ error: "titre requis." }, { status: 400 });
    }

    const correlationIdFinal =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : nouveauCorrelationId();

    const id = await enregistrerSignalStrategique({
      correlationId: correlationIdFinal,
      categorie,
      source,
      titre,
      description: typeof body?.description === "string" ? body.description : undefined,
    });

    if (!id) {
      return NextResponse.json({ error: "Échec de l'enregistrement du signal." }, { status: 500 });
    }

    return NextResponse.json({ id, correlationId: correlationIdFinal }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création du signal stratégique." }, { status: 500 });
  }
}
