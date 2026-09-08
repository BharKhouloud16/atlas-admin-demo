import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enregistrerRapportAgent,
  nouveauCorrelationId,
  AGENTS_EMETTEURS,
  TYPES_RAPPORT,
  STATUTS_RAPPORT,
  type AgentEmetteurRapport,
  type StatutRapportAgentValeur,
} from "@/lib/gouvernance/rapports";

// COMPANY ATLAS — B18 (08/09/2026) : lecture/écriture du registre de
// rapports inter-agents (RapportAgent, voir lib/gouvernance/rapports.ts).
// Réservé ADMIN, même discipline que /api/security/evenements et
// /api/security/runtime (B16/B17) : ces routes ne figurent PAS dans
// middleware.ts (aucune route sous /api/security ne l'a jamais été — ni
// dans PUBLIC_PATHS, ni dans les préfixes protégés, ni dans
// config.matcher), la protection est assurée ICI, dans chaque route, par
// getSession()+role. Audit B18 confirmé : aucune modification de
// middleware.ts n'était donc nécessaire pour cette nouvelle route
// (contrainte 6 de la directive B18 — pas de changement RBAC sans
// nécessité technique démontrée, et ici il n'y en avait aucune).
//
// Le POST reste un geste ADMIN authentifié explicite (comme la création
// d'un Client ou d'une Mission ailleurs dans l'app) — pas un comportement
// autonome déclenché par un agent (contrainte 7 de la directive B18).

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
    const agentEmetteur = searchParams.get("agentEmetteur") ?? undefined;
    const statut = searchParams.get("statut") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const rapports = await prisma.rapportAgent.findMany({
      where: {
        ...(correlationId ? { correlationId } : {}),
        ...(agentEmetteur && (AGENTS_EMETTEURS as readonly string[]).includes(agentEmetteur)
          ? { agentEmetteur: agentEmetteur as AgentEmetteurRapport }
          : {}),
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
    const agentEmetteur = body?.agentEmetteur;
    const typeRapport = body?.typeRapport;
    const statut = body?.statut;
    const objectif = body?.objectif;

    if (!agentEmetteur || !(AGENTS_EMETTEURS as readonly string[]).includes(agentEmetteur)) {
      return NextResponse.json(
        { error: "agentEmetteur invalide : doit être l'un des 4 agents de l'architecture officielle COMPANY ATLAS." },
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
      agentEmetteur,
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
