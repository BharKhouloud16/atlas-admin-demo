import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reconstituerHistorique } from "@/lib/control-plane/why";
import { estCorrelationIdValide } from "@/lib/control-plane/domain";

// COMPANY ATLAS — B22 (14/09/2026) : WHY ENGINE — lecture seule. Réservé
// ADMIN. Reconstitue l'historique complet d'un correlationId (Decision,
// DecisionOption, Delegation, AuthorizationRequest, AuditEvent) — aucune
// mutation, aucun nouveau stockage, aucun LLM (directive B22, section 15).

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const correlationId = searchParams.get("correlationId");

    if (!correlationId || correlationId.length === 0) {
      return NextResponse.json({ error: "correlationId requis." }, { status: 400 });
    }
    if (!estCorrelationIdValide(correlationId)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }

    const historique = await reconstituerHistorique(correlationId);
    return NextResponse.json(historique);
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la reconstitution de l'historique." }, { status: 500 });
  }
}
