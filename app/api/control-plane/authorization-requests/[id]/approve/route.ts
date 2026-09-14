import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { approuverDemande } from "@/lib/control-plane/authorization";
import { estAuthorizationDecisionValide } from "@/lib/control-plane/domain";

// COMPANY ATLAS — B22 (14/09/2026) : SEULE route capable de résoudre
// humainement une AuthorizationRequest en attente. Réservé ADMIN.
// decidedBy TOUJOURS session.email — JAMAIS le corps de la requête, jamais
// un agent (aucune session agent n'existe, limite héritée B19/B20/B21) :
// l'auto-approbation est donc structurellement impossible, pas seulement
// vérifiée. Seules ALLOW/DENY sont acceptées ici (jamais APPROVAL_REQUIRED
// ni RESTRICT depuis une résolution humaine).

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const decision = body?.decision;
    const decisionReason = body?.decisionReason;

    if (!estAuthorizationDecisionValide(decision) || (decision !== "ALLOW" && decision !== "DENY")) {
      return NextResponse.json({ error: "decision doit être ALLOW ou DENY (jamais APPROVAL_REQUIRED ni RESTRICT depuis une résolution humaine)." }, { status: 400 });
    }
    if (typeof decisionReason !== "string" || decisionReason.trim().length === 0) {
      return NextResponse.json({ error: "decisionReason requis." }, { status: 400 });
    }

    const resultat = await approuverDemande({
      id: params.id,
      decision,
      decisionReason,
      decidedBy: session.email, // TOUJOURS la session ADMIN authentifiée — jamais le corps de la requête
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
    }

    return NextResponse.json({ id: params.id, decision: resultat.decision, status: resultat.status, decidedBy: session.email });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la résolution de la demande d'autorisation." }, { status: 500 });
  }
}
