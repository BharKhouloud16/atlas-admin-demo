import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recommander } from "@/lib/control-plane/decisions";
import { estConfidenceValide } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";

// COMPANY ATLAS — B22 (14/09/2026) : fixe la recommandation d'une
// Decision. confidence : null accepté, sinon strictement 0.0-1.0, sinon
// 400 sans écriture (Phase 3-FIX, point 4) — jamais une autorisation
// implicite, purement déclaratif (Why Engine). Jamais réémise (409 si
// déjà RECOMMENDED/CANCELLED).

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const recommendedOptionId = body?.recommendedOptionId;
    const confidence = body?.confidence;

    if (typeof recommendedOptionId !== "string" || recommendedOptionId.trim().length === 0) {
      return NextResponse.json({ error: "recommendedOptionId requis." }, { status: 400 });
    }
    if (confidence !== undefined && confidence !== null && !estConfidenceValide(confidence)) {
      return NextResponse.json({ error: "confidence invalide : doit être null ou compris entre 0.0 et 1.0." }, { status: 400 });
    }

    const resultat = await recommander({
      decisionId: params.id,
      recommendedOptionId,
      confidence: typeof confidence === "number" ? confidence : null,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    await enregistrerAuditEvent({
      correlationId: resultat.decision.correlationId,
      objectType: "DECISION",
      objectId: resultat.decision.id,
      action: "recommended",
      actor: session.email,
      agentId: resultat.decision.agentId,
    });

    return NextResponse.json({
      id: resultat.decision.id,
      recommendedOptionId: resultat.decision.recommendedOptionId,
      confidence: resultat.decision.confidence,
      humanNecessity: resultat.decision.humanNecessity,
      status: resultat.decision.status,
    });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la recommandation." }, { status: 500 });
  }
}
