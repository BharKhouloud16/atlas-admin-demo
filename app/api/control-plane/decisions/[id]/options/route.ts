import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ajouterOption } from "@/lib/control-plane/decisions";
import { estBrandImpactValide, estRiskLevelValide, estEvidenceQualityValide } from "@/lib/control-plane/domain";
import { enregistrerAuditEvent } from "@/lib/control-plane/audit";

// COMPANY ATLAS — B22 (14/09/2026) : DecisionOption — une alternative pour
// une Decision existante. correlationId TOUJOURS celui de la Decision
// parente (jamais accepté du corps de la requête, même discipline que
// route-derives.ts, B21.1/M3). Dimensions explicites, aucun score/rank
// calculé (directive B22, section 7/8).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const decisionId = params.id;
    const decision = await prisma.decision.findUnique({ where: { id: decisionId } });
    if (!decision) {
      return NextResponse.json({ error: "decisionId invalide : aucune Decision correspondante." }, { status: 400 });
    }
    if (decision.status !== "OPEN") {
      return NextResponse.json(
        { error: `Decision déjà au statut ${decision.status} — impossible d'ajouter une option.` },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => null);
    const label = body?.label;
    const description = body?.description;
    const riskLevel = body?.riskLevel;
    const riskJustification = body?.riskJustification;
    const brandImpact = body?.brandImpact;
    const evidenceQuality = body?.evidenceQuality;

    if (typeof label !== "string" || label.trim().length === 0) {
      return NextResponse.json({ error: "label requis." }, { status: 400 });
    }
    if (typeof description !== "string" || description.trim().length === 0) {
      return NextResponse.json({ error: "description requise." }, { status: 400 });
    }
    if (riskLevel !== undefined && !estRiskLevelValide(riskLevel)) {
      return NextResponse.json({ error: "riskLevel invalide." }, { status: 400 });
    }
    if (riskLevel !== undefined && (typeof riskJustification !== "string" || riskJustification.trim().length === 0)) {
      return NextResponse.json({ error: "riskJustification requise et non vide dès que riskLevel est renseigné." }, { status: 400 });
    }
    if (brandImpact !== undefined && !estBrandImpactValide(brandImpact)) {
      return NextResponse.json({ error: "brandImpact invalide." }, { status: 400 });
    }
    if (evidenceQuality !== undefined && !estEvidenceQualityValide(evidenceQuality)) {
      return NextResponse.json({ error: "evidenceQuality invalide." }, { status: 400 });
    }

    const option = await ajouterOption({
      decisionId,
      correlationId: decision.correlationId, // toujours celui de la Decision parente, jamais du body
      label,
      description,
      businessImpact: typeof body?.businessImpact === "string" ? body.businessImpact : undefined,
      financialImpact: typeof body?.financialImpact === "string" ? body.financialImpact : undefined,
      strategicImpact: typeof body?.strategicImpact === "string" ? body.strategicImpact : undefined,
      clientImpact: typeof body?.clientImpact === "string" ? body.clientImpact : undefined,
      brandImpact,
      riskLevel,
      riskJustification: typeof riskJustification === "string" ? riskJustification : undefined,
      reversibility: typeof body?.reversibility === "string" ? body.reversibility : undefined,
      evidenceQuality,
    });

    await enregistrerAuditEvent({
      correlationId: decision.correlationId,
      objectType: "DECISION_OPTION",
      objectId: option.id,
      action: "created",
      actor: session.email,
      agentId: decision.agentId,
    });

    return NextResponse.json({ id: option.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de l'option." }, { status: 500 });
  }
}
