import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listerAgentsIdentity } from "@/lib/agents/identity";
import { listerPermissionsAgent, possedePermissionActive } from "@/lib/agents/permissions";
import { creerPropositionAction } from "@/lib/strategic/propositions";
import { nouveauCorrelationId } from "@/lib/security/events";
import { estCorrelationIdValide, estStrategicProposalStatutValide } from "@/lib/strategic/domain";

// COMPANY ATLAS — B21 (13/09/2026) : lecture/écriture des
// StrategicActionProposal (voir lib/strategic/propositions.ts). Réservé
// ADMIN, même discipline que les autres routes /api/strategic/*. Étape
// "Recommandation -> Proposition" du cycle cible : une proposition créée
// ici reste au statut PROPOSEE — voir
// app/api/strategic/propositions/[id]/autoriser/route.ts pour la seule
// route capable de la faire progresser vers AUTORISEE (jamais cette
// route-ci : créer une proposition ne l'autorise jamais soi-même).
//
// B21.1 — M1 (13/09/2026, durcissement) : avant de créer la proposition, ce
// POST vérifie désormais que l'agent possède réellement une AgentPermission
// PROPOSE active (B20, lib/agents/permissions.ts) — jusqu'ici seule
// l'existence/activité de l'AgentIdentity était vérifiée, jamais le
// Permission Registry lui-même. Ne contourne jamais AgentPermission, ne
// crée aucun nouveau champ `scope` d'API ni aucune correspondance entre
// StrategicCategory et AgentPermissionScope (directive B21.1) : l'agent est
// autorisé dès qu'une permission PROPOSE active existe pour lui, quel que
// soit le scope qu'elle porte.

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
    const permissions = await listerPermissionsAgent();
    if (!possedePermissionActive(permissions, agentId, "PROPOSE")) {
      return NextResponse.json(
        { error: "agentId invalide : aucune permission PROPOSE active (AgentPermission, B20) pour cet agent." },
        { status: 400 }
      );
    }
    if (typeof actionProposee !== "string" || actionProposee.trim().length === 0) {
      return NextResponse.json({ error: "actionProposee requise." }, { status: 400 });
    }

    // B21.1 — M2 (correction) : correlationId est un identifiant de
    // traçabilité, jamais tronqué — une valeur trop longue est un refus
    // explicite (400), pas une troncature silencieuse.
    const correlationIdBrut =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : undefined;
    if (correlationIdBrut && !estCorrelationIdValide(correlationIdBrut)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }
    const correlationIdFinal = correlationIdBrut ?? nouveauCorrelationId();

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
