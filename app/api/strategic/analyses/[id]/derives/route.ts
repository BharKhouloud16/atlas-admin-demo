import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enregistrerOpportuniteStrategique,
  enregistrerMenaceStrategique,
  enregistrerRecommandationStrategique,
} from "@/lib/strategic/veille";
import { estStrategicPriorityValide } from "@/lib/strategic/domain";

// COMPANY ATLAS — B21 (13/09/2026) : dérive une StrategicOpportunity, une
// StrategicThreat ou une StrategicRecommendation à partir d'une
// StrategicAnalysis existante (étape "Analyse -> Opportunité/Menace" du
// cycle cible). Réservé ADMIN, même discipline que les autres routes
// /api/strategic/*. Un seul type par appel (`type`: "opportunite" |
// "menace" | "recommandation") — aucun score/priorité n'est calculé ici,
// `priorite` est toujours saisie par l'appelant (lib/strategic/domain.ts).

const TYPES_DERIVES = ["opportunite", "menace", "recommandation"] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const analysisId = params.id;
    const analysis = await prisma.strategicAnalysis.findUnique({ where: { id: analysisId } });
    if (!analysis) {
      return NextResponse.json({ error: "analysisId invalide : aucune StrategicAnalysis correspondante." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const type = body?.type;
    const description = body?.description ?? body?.recommandation;
    const priorite = body?.priorite;

    if (!type || !(TYPES_DERIVES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: `type invalide, attendu l'un de : ${TYPES_DERIVES.join(", ")}.` }, { status: 400 });
    }
    if (typeof description !== "string" || description.trim().length === 0) {
      return NextResponse.json({ error: "description (ou recommandation) requise." }, { status: 400 });
    }
    if (!estStrategicPriorityValide(priorite)) {
      return NextResponse.json({ error: "priorite invalide." }, { status: 400 });
    }

    // B21.1 — M3 : correlationId est TOUJOURS celui de la StrategicAnalysis
    // parente, déjà relue ci-dessus (`analysis`) — jamais accepté depuis le
    // corps de la requête, pour garantir une propagation déterministe.
    let id: string | null = null;
    if (type === "opportunite") {
      id = await enregistrerOpportuniteStrategique({ analysisId, correlationId: analysis.correlationId, description, priorite });
    } else if (type === "menace") {
      id = await enregistrerMenaceStrategique({ analysisId, correlationId: analysis.correlationId, description, priorite });
    } else {
      id = await enregistrerRecommandationStrategique({
        analysisId,
        correlationId: analysis.correlationId,
        recommandation: description,
        priorite,
      });
    }

    if (!id) {
      return NextResponse.json({ error: "Échec de l'enregistrement." }, { status: 500 });
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
  }
}
