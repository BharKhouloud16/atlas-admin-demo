import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { creerPropositionAction } from "@/lib/strategic/propositions";
import { nouveauCorrelationId } from "@/lib/security/events";
import { estStrategicProposalStatutValide } from "@/lib/strategic/domain";

// COMPANY ATLAS — B21 (13/09/2026) : lecture/écriture des
// StrategicActionProposal (voir lib/strategic/propositions.ts). Réservé
// ADMIN, même discipline que les autres routes /api/strategic/*. Étape
// "Recommandation -> Proposition" du cycle cible : une proposition créée
// ici reste au statut PROPOSEE — voir
// app/api/strategic/propositions/[id]/autoriser/route.ts pour la seule
// route capable de la faire progresser vers AUTORISEE (jamais cette
// route-ci : créer une proposition ne l'autorise jamais soi-même).

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const statut = searchParams.get("statut") ?? undefined;
    const agentId = searchParams.get("agentId") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const propositions = await prisma.strategicActionProposal.findMany({
      where: {
        ...(statut && estStrategicProposalStatutValide(statut) ? { statut } : {}),
        ...(agentId ? { agentId } : {}),
      },
      include: { autorisation: true },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ propositions });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des propositions stratégiques." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const recommendationId = body?.recommendationId;
    const agentId = body?.agentId;
    const actionProposee = body?.actionProposee;

    if (typeof recommendationId !== "string" || recommendationId.trim().length === 0) {
      return NextResponse.json({ error: "recommendationId requis." }, { status: 400 });
    }
    const recommendation = await prisma.strategicRecommendation.findUnique({ where: { id: recommendationId } });
    if (!recommendation) {
      return NextResponse.json({ error: "recommendationId invalide." }, { status: 400 });
    }
    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      return NextResponse.json(
        { error: "agentId requis : doit référencer une identité AgentIdentity existante (voir GET /api/security/agents)." },
        { status: 400 }
      );
    }
    const agents = await listerAgentsIdentity();
    const agentValide = agents.find((a) => a.id === agentId && a.statut === "ACTIVE");
    if (!agentValide) {
      return NextResponse.json({ error: "agentId invalide : doit référencer une identité AgentIdentity active." }, { status: 400 });
    }
    if (typeof actionProposee !== "string" || actionProposee.trim().length === 0) {
      return NextResponse.json({ error: "actionProposee requise." }, { status: 400 });
    }

    const correlationIdFinal =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : nouveauCorrelationId();

    const id = await creerPropositionAction({
      correlationId: correlationIdFinal,
      recommendationId,
      agentId,
      actionProposee,
      perimetre: typeof body?.perimetre === "string" ? body.perimetre : undefined,
    });

    if (!id) {
      return NextResponse.json({ error: "Échec de l'enregistrement de la proposition." }, { status: 500 });
    }

    return NextResponse.json({ id, correlationId: correlationIdFinal, statut: "PROPOSEE" }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de la proposition." }, { status: 500 });
  }
}
