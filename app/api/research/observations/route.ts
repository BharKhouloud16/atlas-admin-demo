import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ATLAS V1 — Intelligence Foundation. Une observation = une information
// extraite d'une source précise pour une recherche précise (voir mandat
// section 17). queryId et sourceId doivent appartenir l'un à l'autre —
// jamais un mélange entre deux recherches distinctes.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const queryId = typeof body.queryId === "string" ? body.queryId : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const contenu = typeof body.contenu === "string" ? body.contenu.trim() : "";
  if (!queryId || !sourceId || !contenu) {
    return NextResponse.json({ error: "queryId, sourceId et contenu sont requis" }, { status: 400 });
  }

  const source = await prisma.researchSource.findUnique({ where: { id: sourceId }, select: { id: true, queryId: true } });
  if (!source || source.queryId !== queryId) {
    return NextResponse.json({ error: "Source introuvable pour cette recherche" }, { status: 404 });
  }

  const observation = await prisma.researchObservation.create({
    data: { queryId, sourceId, contenu },
  });

  await prisma.researchQuery.update({ where: { id: queryId }, data: { statut: "RESULTAT_TROUVE" } });

  return NextResponse.json(observation, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const queryId = req.nextUrl.searchParams.get("queryId");
  const observations = await prisma.researchObservation.findMany({
    where: queryId ? { queryId } : undefined,
    include: { source: { select: { url: true, publisher: true, scope: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(observations);
}
