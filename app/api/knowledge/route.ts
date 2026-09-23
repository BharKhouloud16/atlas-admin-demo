import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const TYPES_VALIDES = [
  "FACT", "STANDARD", "REGULATION", "REQUIREMENT", "FRAMEWORK", "GUIDELINE",
  "BEST_PRACTICE", "METHODOLOGY", "HEURISTIC", "OPINION", "NEWS", "OBSERVATION",
] as const;

// ATLAS V1 — Intelligence Foundation. Knowledge OS : mémoire professionnelle
// réutilisable d'ATLAS (voir mandat sections 18-20). Créée exclusivement
// par un Admin — jamais dérivée automatiquement d'une donnée Client (voir
// Evidence, jamais l'inverse). Réservé Admin, même discipline que
// /api/service-engagements (aucun ajout middleware.ts).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const type = typeof body.type === "string" ? body.type : "";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!title || !summary || !domain) {
    return NextResponse.json({ error: "title, summary et domain sont requis" }, { status: 400 });
  }
  if (!(TYPES_VALIDES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "Type de connaissance invalide" }, { status: 400 });
  }

  const knowledge = await prisma.knowledge.create({
    data: {
      title,
      summary,
      type: type as (typeof TYPES_VALIDES)[number],
      domain,
      source: typeof body.source === "string" ? body.source.trim() || null : null,
      publisher: typeof body.publisher === "string" ? body.publisher.trim() || null : null,
      version: typeof body.version === "string" ? body.version.trim() || null : null,
      publicationDate: body.publicationDate ? new Date(body.publicationDate) : null,
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
      scope: typeof body.scope === "string" ? body.scope.trim() || null : null,
      createdByEmail: session.email,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "knowledge.creee",
    cible: `knowledge:${knowledge.id}`,
    detail: knowledge.title,
  });

  return NextResponse.json(knowledge, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const domain = req.nextUrl.searchParams.get("domain");
  const type = req.nextUrl.searchParams.get("type");
  const knowledge = await prisma.knowledge.findMany({
    where: {
      domain: domain ?? undefined,
      type: (type as (typeof TYPES_VALIDES)[number]) ?? undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(knowledge);
}
