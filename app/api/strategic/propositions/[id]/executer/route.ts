import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { obtenirDemandeCouranteStrategique } from "@/lib/strategic/authorization-status";
import { creerAdaptateurExecutionProposition } from "@/lib/strategic/execution-adapter";
import { executerActionControlee } from "@/lib/control-plane/execution-engine";

// COMPANY ATLAS — B27 (14/09/2026) : SEULE route capable de faire passer
// une StrategicActionProposal à EXECUTEE — et UNIQUEMENT après un succès
// RÉEL de l'ActionAdapter (lib/strategic/execution-adapter.ts). Premier
// parcours d'exécution end-to-end réel : Authorization (B22) -> Guard (B25,
// guardExecution) -> Execution Engine (B26, executerActionControlee) ->
// ActionAdapter -> StrategicActionProposal.statut. Réservé ADMIN.
//
// AUCUN input client au-delà de l'id de proposition dans l'URL — le corps
// de la requête n'est même jamais lu. agentId/action/scope/correlationId
// sont TOUJOURS dérivés côté serveur de l'AuthorizationRequest COURANTE de
// cette proposition (obtenirDemandeCouranteStrategique, B24 Lot C2/B27) —
// structurellement impossible pour un client d'imposer une décision, un
// agentId, un scope, un risque ou un statut EXECUTEE (directive B27,
// section 17).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: params.id } });
    if (!proposition) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }

    const demande = await obtenirDemandeCouranteStrategique(params.id);
    if (!demande) {
      return NextResponse.json(
        { error: "Aucune AuthorizationRequest B22 associée à cette proposition — impossible d'exécuter." },
        { status: 409 }
      );
    }

    const resultat = await executerActionControlee(
      {
        agentId: demande.agentId,
        action: demande.action,
        scope: demande.scope,
        authorizationRequestId: demande.id,
        correlationId: demande.correlationId,
      },
      creerAdaptateurExecutionProposition(params.id)
    );

    // GUARD ALLOW ≠ EXECUTEE (directive B27, section 15) — resultat.executed
    // === false signifie que le Guard a refusé AVANT toute tentative
    // (DENY/APPROVAL_REQUIRED) : l'ActionAdapter n'a jamais été invoqué,
    // jamais une transition partielle.
    if (!resultat.executed) {
      return NextResponse.json(
        { error: `Exécution refusée avant toute tentative — décision du Guard : ${resultat.guard.decision}.`, guard: resultat.guard.decision },
        { status: 409 }
      );
    }
    // L'adaptateur a été invoqué mais a échoué (idempotence, incohérence
    // défensive, ou tout autre refus métier) — jamais une fausse réussite.
    if (!resultat.resultat.ok) {
      return NextResponse.json({ error: resultat.resultat.detail }, { status: 409 });
    }

    return NextResponse.json({ id: params.id, statut: "EXECUTEE", detail: resultat.resultat.detail }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de l'exécution de la proposition." }, { status: 500 });
  }
}
