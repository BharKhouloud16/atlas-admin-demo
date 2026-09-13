import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { enregistrerDecision } from "@/lib/control-plane/decisions";
import { estCorrelationIdValide } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B22 (14/09/2026) : DECISION ENGINE. Réservé ADMIN, même
// discipline que /api/strategic/* et /api/security/* — cette route ne
// figure pas dans middleware.ts, la protection est assurée ICI par
// getSession()+role.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const correlationId = searchParams.get("correlationId") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const decisions = await prisma.decision.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ decisions });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des décisions." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const agentId = body?.agentId;
    const objective = body?.objective;

    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      return NextResponse.json({ error: "agentId requis." }, { status: 400 });
    }
    const agents = await listerAgentsIdentity();
    const agentValide = agents.find((a) => a.id === agentId && a.statut === "ACTIVE");
    if (!agentValide) {
      return NextResponse.json({ error: "agentId invalide : doit référencer une identité AgentIdentity active." }, { status: 400 });
    }
    if (typeof objective !== "string" || objective.trim().length === 0) {
      return NextResponse.json({ error: "objective requis." }, { status: 400 });
    }

    const correlationIdBrut =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : undefined;
    if (correlationIdBrut && !estCorrelationIdValide(correlationIdBrut)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }
    const correlationIdFinal = correlationIdBrut ?? nouveauCorrelationId();

    const decision = await enregistrerDecision({
      correlationId: correlationIdFinal,
      agentId,
      objective,
      context: typeof body?.context === "string" ? body.context : undefined,
      createdBy: session.email,
    });

    await enregistrerAuditEvent({
      correlationId: correlationIdFinal,
      objectType: "DECISION",
      objectId: decision.id,
      action: "created",
      actor: session.email,
      agentId,
    });

    return NextResponse.json({ id: decision.id, correlationId: correlationIdFinal, status: decision.status }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de la décision." }, { status: 500 });
  }
}
