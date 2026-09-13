import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { estAgentPermissionActionValide, estAgentPermissionScopeValide } from "@/lib/agents/permissions";
import { creerDemandeAutorisation } from "@/lib/control-plane/authorization";
import { estAutonomyLevelSupporte, estAutonomyLevelValide, estCorrelationIdValide, estRiskLevelValide } from "@/lib/control-plane/domain";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B22 (14/09/2026) : AuthorizationRequest — modèle
// fusionné (pas de AuthorizationDecision ni HumanApproval séparés).
// requestedAutonomyLevel > L4 refusé (400) AVANT toute écriture — aucune
// ligne créée pour un niveau non supporté (directive B22, section 7/12).

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

    const authorizationRequests = await prisma.authorizationRequest.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ authorizationRequests });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des demandes d'autorisation." }, { status: 500 });
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
    const action = body?.action;
    const scope = body?.scope;
    const objective = body?.objective;
    const reason = body?.reason;
    const requestedAutonomyLevel = body?.requestedAutonomyLevel;
    const riskLevel = body?.riskLevel;
    const riskJustification = body?.riskJustification;
    const amount = body?.amount;

    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      return NextResponse.json({ error: "agentId requis." }, { status: 400 });
    }
    const agents = await listerAgentsIdentity();
    const agentValide = agents.find((a) => a.id === agentId && a.statut === "ACTIVE");
    if (!agentValide) {
      return NextResponse.json({ error: "agentId invalide : doit référencer une identité AgentIdentity active." }, { status: 400 });
    }
    if (!estAgentPermissionActionValide(action)) {
      return NextResponse.json({ error: "action invalide (vocabulaire AgentPermissionAction, B20)." }, { status: 400 });
    }
    if (!estAgentPermissionScopeValide(scope)) {
      return NextResponse.json({ error: "scope invalide (vocabulaire AgentPermissionScope, B20)." }, { status: 400 });
    }
    if (typeof objective !== "string" || objective.trim().length === 0) {
      return NextResponse.json({ error: "objective requis." }, { status: 400 });
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason requis." }, { status: 400 });
    }
    if (!estAutonomyLevelValide(requestedAutonomyLevel)) {
      return NextResponse.json({ error: "requestedAutonomyLevel invalide." }, { status: 400 });
    }
    if (!estAutonomyLevelSupporte(requestedAutonomyLevel)) {
      return NextResponse.json(
        { error: `requestedAutonomyLevel ${requestedAutonomyLevel} non supporté par cette fondation B22 (maximum : L4_EXECUTE_WITH_APPROVAL).` },
        { status: 400 }
      );
    }
    if (riskLevel !== undefined && !estRiskLevelValide(riskLevel)) {
      return NextResponse.json({ error: "riskLevel invalide." }, { status: 400 });
    }
    if (riskLevel !== undefined && (typeof riskJustification !== "string" || riskJustification.trim().length === 0)) {
      return NextResponse.json({ error: "riskJustification requise et non vide dès que riskLevel est renseigné." }, { status: 400 });
    }
    if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)) {
      return NextResponse.json({ error: "amount invalide : doit être un nombre positif." }, { status: 400 });
    }
    if (typeof body?.delegationId === "string" && body.delegationId.trim().length === 0) {
      return NextResponse.json({ error: "delegationId ne peut pas être une chaîne vide." }, { status: 400 });
    }

    const correlationIdBrut =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : undefined;
    if (correlationIdBrut && !estCorrelationIdValide(correlationIdBrut)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }
    const correlationIdFinal = correlationIdBrut ?? nouveauCorrelationId();

    const resultat = await creerDemandeAutorisation({
      correlationId: correlationIdFinal,
      agentId,
      action,
      scope,
      resource: typeof body?.resource === "string" ? body.resource : undefined,
      objective,
      reason,
      riskLevel,
      riskJustification: typeof riskJustification === "string" ? riskJustification : undefined,
      amount: typeof amount === "number" ? amount : undefined,
      requestedAutonomyLevel,
      decisionId: typeof body?.decisionId === "string" ? body.decisionId : undefined,
      delegationId: typeof body?.delegationId === "string" ? body.delegationId : undefined,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    return NextResponse.json(
      { id: resultat.id, status: resultat.status, decision: resultat.decision, humanNecessity: resultat.humanNecessity },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de la demande d'autorisation." }, { status: 500 });
  }
}
