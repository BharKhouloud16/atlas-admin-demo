import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revoquerDemande } from "@/lib/control-plane/authorization";

// COMPANY ATLAS — B22 (14/09/2026) : révocation ADMIN d'une
// AuthorizationRequest (PENDING ou déjà RESOLVED, avant toute
// consommation par un module métier). revokedBy TOUJOURS session.email.

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const reason = body?.reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason requis." }, { status: 400 });
    }

    const resultat = await revoquerDemande({ id: params.id, revokedBy: session.email, reason });
    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
    }

    return NextResponse.json({ id: params.id, status: "REVOKED" });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la révocation de la demande d'autorisation." }, { status: 500 });
  }
}
