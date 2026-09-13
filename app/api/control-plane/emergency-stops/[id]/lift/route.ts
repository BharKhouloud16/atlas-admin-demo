import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leverArretUrgence } from "@/lib/control-plane/emergency-stop";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";

// COMPANY ATLAS — B22 (14/09/2026) : levée ADMIN d'un arrêt d'urgence.
// liftedBy TOUJOURS session.email — jamais un agent.

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const resultat = await leverArretUrgence({ emergencyStopId: params.id, liftedBy: session.email });
    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    const stop = await prisma.emergencyStop.findUnique({ where: { id: params.id } });
    if (stop) {
      await enregistrerAuditEvent({
        correlationId: stop.correlationId,
        objectType: "EMERGENCY_STOP",
        objectId: stop.id,
        action: "lifted",
        actor: session.email,
      });
    }

    return NextResponse.json({ id: params.id });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la levée de l'arrêt d'urgence." }, { status: 500 });
  }
}
