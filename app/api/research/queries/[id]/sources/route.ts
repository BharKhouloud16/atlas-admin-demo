import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ATLAS V1 — Intelligence Foundation. Attache une source (URL + provenance)
// à une ResearchQuery — voir mandat section 12/17 (garder URL, publisher,
// date, scope, date d'accès).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const query = await prisma.researchQuery.findUnique({ where: { id }, select: { id: true } });
  if (!query) {
    return NextResponse.json({ error: "Recherche introuvable" }, { status: 404 });
  }

  const body = await req.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "L'URL de la source est requise" }, { status: 400 });
  }

  const source = await prisma.researchSource.create({
    data: {
      queryId: id,
      url,
      titre: typeof body.titre === "string" ? body.titre.trim() || null : null,
      publisher: typeof body.publisher === "string" ? body.publisher.trim() || null : null,
      datePublication: body.datePublication ? new Date(body.datePublication) : null,
      scope: typeof body.scope === "string" ? body.scope.trim() || null : null,
    },
  });

  return NextResponse.json(source, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const sources = await prisma.researchSource.findMany({
    where: { queryId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(sources);
}
