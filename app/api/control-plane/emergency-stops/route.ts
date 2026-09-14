import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activerArretUrgence } from "@/lib/control-plane/emergency-stop";
import { estCorrelationIdValide, estEmergencyStopScopeValide } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B22 (14/09/2026) : EMERGENCY STOP. Réservé ADMIN —
// aucun agent ne peut activer ni lever un arrêt d'urgence (directive B22,
// section 13).

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? undefined;
    const actifsSeuls = searchParams.get("actif") === "true";
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const emergencyStops = await prisma.emergencyStop.findMany({
      where: {
        ...(scope ? { scope: scope as never } : {}),
        ...(actifsSeuls ? { liftedAt: null } : {}),
      },
      orderBy: { activatedAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ emergencyStops });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des arrêts d'urgence." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const scope = body?.scope;
    const targetId = body?.targetId;
    const reason = body?.reason;

    if (!estEmergencyStopScopeValide(scope)) {
      return NextResponse.json({ error: "scope invalide." }, { status: 400 });
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason requis." }, { status: 400 });
    }

    const correlationIdBrut =
      typeof body?.correlationId === "string" && body.correlationId.length > 0 ? body.correlationId : undefined;
    if (correlationIdBrut && !estCorrelationIdValide(correlationIdBrut)) {
      return NextResponse.json({ error: "correlationId invalide : ne doit jamais dépasser 300 caractères." }, { status: 400 });
    }
    const correlationIdFinal = correlationIdBrut ?? nouveauCorrelationId();

    const resultat = await activerArretUrgence({
      correlationId: correlationIdFinal,
      scope,
      targetId: typeof targetId === "string" ? targetId : undefined,
      reason,
      activatedBy: session.email,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    await enregistrerAuditEvent({
      correlationId: correlationIdFinal,
      objectType: "EMERGENCY_STOP",
      objectId: resultat.id,
      action: "activated",
      actor: session.email,
      reason,
    });

    return NextResponse.json({ id: resultat.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de l'activation de l'arrêt d'urgence." }, { status: 500 });
  }
}
