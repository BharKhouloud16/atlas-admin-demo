import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { estAgentPermissionActionValide, estAgentPermissionScopeValide } from "@/lib/agents/permissions";
import { creerDelegation } from "@/lib/control-plane/delegations";
import { classifierAction } from "@/lib/control-plane/commitment";
import { estCorrelationIdValide, estRiskLevelValide } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B22 (14/09/2026) : DELEGATION. Réservé ADMIN. Un pouvoir
// explicitement confié par le CEO à un agent, jamais automatique, jamais
// permanent (expiresAt obligatoire). Vérifie que l'AgentPermission
// correspondante est ACTIVE (B20) — ne peut jamais créer une permission
// (directive B22, section 5/9).

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

    const delegations = await prisma.delegation.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ delegations });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des délégations." }, { status: 500 });
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
    const expiresAtBrut = body?.expiresAt;
    const maxAmount = body?.maxAmount;
    const maxRiskLevel = body?.maxRiskLevel;

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
    if (maxAmount !== undefined && maxAmount !== null && (typeof maxAmount !== "number" || !Number.isFinite(maxAmount) || maxAmount < 0)) {
      return NextResponse.json({ error: "maxAmount invalide : doit être un nombre positif ou absent." }, { status: 400 });
    }
    if (maxRiskLevel !== undefined && maxRiskLevel !== null && !estRiskLevelValide(maxRiskLevel)) {
      return NextResponse.json({ error: "maxRiskLevel invalide." }, { status: 400 });
    }
    const expiresAt = typeof expiresAtBrut === "string" ? new Date(expiresAtBrut) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "expiresAt requis (date ISO valide) — aucune délégation permanente implicite." }, { status: 400 });
    }

    const correlationIdBrut =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : undefined;
    if (correlationIdBrut && !estCorrelationIdValide(correlationIdBrut)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }
    const correlationIdFinal = correlationIdBrut ?? nouveauCorrelationId();

    // actionClass TOUJOURS recalculé côté serveur — jamais accepté du body.
    const actionClass = classifierAction(action);

    const resultat = await creerDelegation({
      correlationId: correlationIdFinal,
      agentId,
      action,
      scope,
      resource: typeof body?.resource === "string" ? body.resource : undefined,
      objective,
      actionClass,
      maxAmount: typeof maxAmount === "number" ? maxAmount : null,
      maxRiskLevel: maxRiskLevel ?? null,
      conditions: typeof body?.conditions === "string" ? body.conditions : undefined,
      expiresAt,
      createdBy: session.email,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    await enregistrerAuditEvent({
      correlationId: correlationIdFinal,
      objectType: "DELEGATION",
      objectId: resultat.id,
      action: "created",
      actor: session.email,
      agentId,
    });

    return NextResponse.json({ id: resultat.id, status: "ACTIVE" }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de la délégation." }, { status: 500 });
  }
}
