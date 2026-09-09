import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enregistrerRapportAgent,
  nouveauCorrelationId,
  TYPES_RAPPORT,
  STATUTS_RAPPORT,
  type StatutRapportAgentValeur,
} from "@/lib/gouvernance/rapports";
import { listerAgentsIdentity } from "@/lib/agents/identity";

// COMPANY ATLAS — B18-FIX (10/09/2026) : lecture/écriture du registre de
// rapports inter-agents (RapportAgent, voir lib/gouvernance/rapports.ts),
// reconstruit sur AgentIdentity (B19) comme source unique de vérité —
// voir l'en-tête de lib/gouvernance/rapports.ts pour le détail complet.
// Réservé ADMIN, même discipline que toutes les routes /api/security/*
// précédentes (B16-B20) : cette route ne figure PAS dans middleware.ts
// (aucune route sous /api/security ne l'a jamais été), la protection est
// assurée ICI par getSession()+role.
//
// POST valide désormais agentId contre le registre AgentIdentity réel
// (listerAgentsIdentity(), B19) au lieu de valider un enum libre
// AgentEmetteur — un agentId qui ne correspond à aucune identité ACTIVE
// est rejeté (400). Ceci NE résout PAS le risque d'impersonation déjà
// documenté dans l'audit B18 (l'appelant ADMIN humain choisit toujours
// librement quel agentId indiquer) : cela garantit seulement l'intégrité
// référentielle (l'agentId désigné existe réellement et est ACTIVE), pas
// l'identité réelle de l'appelant. Authentification agent réelle : hors
// périmètre de ce lot, différée (même limite que B19/B20).

function normaliserSeverite(valeur: unknown): "INFO" | "ATTENTION" | "ALERTE" | undefined {
  return valeur === "INFO" || valeur === "ATTENTION" || valeur === "ALERTE" ? valeur : undefined;
}

function normaliserTexte(valeur: unknown): string | undefined {
  return typeof valeur === "string" ? valeur : undefined;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const correlationId = searchParams.get("correlationId") ?? undefined;
    const agentId = searchParams.get("agentId") ?? undefined;
    const statut = searchParams.get("statut") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const rapports = await prisma.rapportAgent.findMany({
      where: {
        ...(correlationId ? { correlationId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(statut && (STATUTS_RAPPORT as readonly string[]).includes(statut)
          ? { statut: statut as StatutRapportAgentValeur }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ rapports });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture du registre de rapports." }, { status: 500 });
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
    const typeRapport = body?.typeRapport;
    const statut = body?.statut;
    const objectif = body?.objectif;

    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json(
        { error: "agentId requis : doit référencer une identité AgentIdentity existante (voir GET /api/security/agents)." },
        { status: 400 }
      );
    }
    const agents = await listerAgentsIdentity();
    const agentValide = agents.find((a) => a.id === agentId && a.statut === "ACTIVE");
    if (!agentValide) {
      return NextResponse.json(
        { error: "agentId invalide : doit référencer une identité AgentIdentity active (voir GET /api/security/agents)." },
        { status: 400 }
      );
    }
    if (!typeRapport || !(TYPES_RAPPORT as readonly string[]).includes(typeRapport)) {
      return NextResponse.json({ error: "typeRapport invalide." }, { status: 400 });
    }
    if (!statut || !(STATUTS_RAPPORT as readonly string[]).includes(statut)) {
      return NextResponse.json({ error: "statut invalide." }, { status: 400 });
    }
    if (typeof objectif !== "string" || objectif.trim().length === 0) {
      return NextResponse.json({ error: "objectif requis." }, { status: 400 });
    }

    const correlationIdFinal =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : nouveauCorrelationId();

    await enregistrerRapportAgent({
      correlationId: correlationIdFinal,
      agentId,
      typeRapport,
      objectif,
      analyse: normaliserTexte(body?.analyse),
      actions: normaliserTexte(body?.actions),
      risques: normaliserTexte(body?.risques),
      statut,
      inconnu: normaliserTexte(body?.inconnu),
      contexte: normaliserTexte(body?.contexte),
      severite: normaliserSeverite(body?.severite),
    });

    return NextResponse.json({ correlationId: correlationIdFinal }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création du rapport." }, { status: 500 });
  }
}
