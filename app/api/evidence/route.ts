import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const TYPES_VALIDES = [
  "DOCUMENT", "SOURCE", "CODE", "CONFIGURATION", "LOG", "SCREENSHOT",
  "OBSERVATION", "TEST_RESULT", "EXTERNAL_REFERENCE", "OTHER",
] as const;

// ATLAS V1 — Intelligence Foundation. Evidence Engine : relie une
// conclusion à sa preuve (voir mandat sections 21, 25). Rattachée à
// EXACTEMENT un contexte : ServiceEngagement (Client) OU Knowledge OU
// ResearchObservation — jamais deux à la fois, jamais zéro (validé ici,
// pas de contrainte DB stricte en V1 faute d'usage réel encore observé,
// voir commentaire schema.prisma). Un contexte Client référencé ici ne
// devient JAMAIS Knowledge automatiquement (règle absolue, section 22).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const type = typeof body.type === "string" ? body.type : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Le titre est requis" }, { status: 400 });
  }
  if (!(TYPES_VALIDES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "Type de preuve invalide" }, { status: 400 });
  }

  const serviceEngagementId = typeof body.serviceEngagementId === "string" ? body.serviceEngagementId : null;
  const knowledgeId = typeof body.knowledgeId === "string" ? body.knowledgeId : null;
  const researchObservationId = typeof body.researchObservationId === "string" ? body.researchObservationId : null;
  const contextesFournis = [serviceEngagementId, knowledgeId, researchObservationId].filter(Boolean);
  if (contextesFournis.length !== 1) {
    return NextResponse.json(
      { error: "Une Evidence doit être rattachée à exactement un contexte (serviceEngagementId, knowledgeId ou researchObservationId)" },
      { status: 400 }
    );
  }

  if (serviceEngagementId) {
    const engagement = await prisma.serviceEngagement.findUnique({ where: { id: serviceEngagementId }, select: { id: true } });
    if (!engagement) return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }
  if (knowledgeId) {
    const knowledge = await prisma.knowledge.findUnique({ where: { id: knowledgeId }, select: { id: true } });
    if (!knowledge) return NextResponse.json({ error: "Knowledge introuvable" }, { status: 404 });
  }
  if (researchObservationId) {
    const observation = await prisma.researchObservation.findUnique({ where: { id: researchObservationId }, select: { id: true } });
    if (!observation) return NextResponse.json({ error: "Observation introuvable" }, { status: 404 });
  }

  const evidence = await prisma.evidence.create({
    data: {
      type: type as (typeof TYPES_VALIDES)[number],
      title,
      detail: typeof body.detail === "string" ? body.detail.trim() || null : null,
      serviceEngagementId,
      knowledgeId,
      researchObservationId,
      createdByEmail: session.email,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "evidence.creee",
    cible: `evidence:${evidence.id}`,
    detail: evidence.title,
  });

  return NextResponse.json(evidence, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const serviceEngagementId = req.nextUrl.searchParams.get("serviceEngagementId");
  const knowledgeId = req.nextUrl.searchParams.get("knowledgeId");
  const researchObservationId = req.nextUrl.searchParams.get("researchObservationId");

  const evidences = await prisma.evidence.findMany({
    where: {
      serviceEngagementId: serviceEngagementId ?? undefined,
      knowledgeId: knowledgeId ?? undefined,
      researchObservationId: researchObservationId ?? undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(evidences);
}
