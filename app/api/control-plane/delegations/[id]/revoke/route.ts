import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revoquerDelegation } from "@/lib/control-plane/delegations";
import { plafonnerTexteControlPlane, PLAFOND_CHAMP_CONTROL_PLANE } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";

// COMPANY ATLAS — B22 (14/09/2026) : révocation ADMIN d'une Delegation.
// revokedBy TOUJOURS session.email, jamais l'agent lui-même, jamais le
// corps de la requête.

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const reason = plafonnerTexteControlPlane(typeof body?.reason === "string" ? body.reason : undefined, PLAFOND_CHAMP_CONTROL_PLANE);
    if (!reason) {
      return NextResponse.json({ error: "reason requis et non vide." }, { status: 400 });
    }

    const resultat = await revoquerDelegation({ delegationId: params.id, revokedBy: session.email, reason });
    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    const delegation = await prisma.delegation.findUnique({ where: { id: params.id } });
    if (delegation) {
      await enregistrerAuditEvent({
        correlationId: delegation.correlationId,
        objectType: "DELEGATION",
        objectId: delegation.id,
        action: "revoked",
        actor: session.email,
        agentId: delegation.agentId,
        reason,
      });
    }

    return NextResponse.json({ id: params.id, status: "REVOKED" });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la révocation de la délégation." }, { status: 500 });
  }
}
