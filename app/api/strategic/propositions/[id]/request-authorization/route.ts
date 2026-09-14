import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { demanderAutorisationStrategique } from "@/lib/strategic/authorization-request";

// COMPANY ATLAS — B24 Lot B (14/09/2026) : SEULE route capable de créer une
// AuthorizationRequest B22 depuis une StrategicActionProposal B21. Réservé
// ADMIN, même discipline RBAC que le reste de /api/strategic/*.
//
// `agentId` et `correlationId` ne sont JAMAIS lus depuis le corps de la
// requête — ils sont TOUJOURS dérivés côté serveur de la
// StrategicActionProposal elle-même (voir lib/strategic/authorization-request.ts).
// `authorizationRequestId`/`decision`/`approvedBy` n'existent nulle part
// dans ce payload : cette route ne les lit jamais, donc un client qui les
// enverrait n'a structurellement aucun effet (même discipline que
// `autorisateurEmail` sur POST .../autoriser).
//
// Toute la décision d'autorisation reste intégralement B22
// (creerDemandeAutorisation, non modifié) — cette route ne fait que
// transmettre action/scope/requestedAutonomyLevel choisis explicitement par
// l'ADMIN, jamais un mapping automatique depuis StrategicCategory (directive
// B24 Lot B, section 5).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);

    const resultat = await demanderAutorisationStrategique({
      proposalId: params.id,
      action: body?.action,
      scope: body?.scope,
      requestedAutonomyLevel: body?.requestedAutonomyLevel,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
    }

    return NextResponse.json(
      {
        authorizationRequestId: resultat.authorizationRequestId,
        linkId: resultat.linkId,
        status: resultat.status,
        decision: resultat.decision,
        humanNecessity: resultat.humanNecessity,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la demande d'autorisation." }, { status: 500 });
  }
}
