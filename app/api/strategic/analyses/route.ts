import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enregistrerAnalyseStrategique } from "@/lib/strategic/veille";
import { nouveauCorrelationId } from "@/lib/security/events";
import { plafonnerCorrelationId } from "@/lib/strategic/domain";

// COMPANY ATLAS — B21 (13/09/2026) : lecture/écriture des StrategicAnalysis
// (voir lib/strategic/veille.ts). Réservé ADMIN, même discipline que
// app/api/strategic/signaux/route.ts. Étape "Signal -> Analyse" du cycle
// cible B21 : `constat` doit être appuyé sur le signal d'origine
// (evidence-first) ; `hypothese` reste distincte d'un fait confirmé ;
// `inconnu` est un champ UNKNOWN explicite, jamais déduit.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const signalId = searchParams.get("signalId") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const analyses = await prisma.strategicAnalysis.findMany({
      where: { ...(signalId ? { signalId } : {}) },
      include: { opportunites: true, menaces: true, recommandations: true },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ analyses });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des analyses stratégiques." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const signalId = body?.signalId;
    const constat = body?.constat;

    if (typeof signalId !== "string" || signalId.trim().length === 0) {
      return NextResponse.json({ error: "signalId requis : doit référencer un StrategicSignal existant." }, { status: 400 });
    }
    const signal = await prisma.strategicSignal.findUnique({ where: { id: signalId } });
    if (!signal) {
      return NextResponse.json({ error: "signalId invalide : aucun StrategicSignal correspondant." }, { status: 400 });
    }
    if (typeof constat !== "string" || constat.trim().length === 0) {
      return NextResponse.json({ error: "constat requis — evidence-first, jamais une affirmation sans preuve." }, { status: 400 });
    }

    const correlationIdFinal = plafonnerCorrelationId(
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : nouveauCorrelationId()
    );

    const id = await enregistrerAnalyseStrategique({
      correlationId: correlationIdFinal,
      signalId,
      constat,
      preuves: typeof body?.preuves === "string" ? body.preuves : undefined,
      hypothese: typeof body?.hypothese === "string" ? body.hypothese : undefined,
      inconnu: typeof body?.inconnu === "string" ? body.inconnu : undefined,
    });

    if (!id) {
      return NextResponse.json({ error: "Échec de l'enregistrement de l'analyse." }, { status: 500 });
    }

    return NextResponse.json({ id, correlationId: correlationIdFinal }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de l'analyse stratégique." }, { status: 500 });
  }
}
