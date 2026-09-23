import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const STATUTS_VALIDES = ["DISCOVERED", "VERIFIED", "PUBLISHED", "UPDATED", "SUPERSEDED", "ARCHIVED"] as const;

// ATLAS V1 — Intelligence Foundation. Lecture/transition de statut d'une
// Knowledge — voir mandat section 20 (lifecycle), jamais d'écrasement
// silencieux : une Knowledge SUPERSEDED reste lisible, jamais supprimée.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const knowledge = await prisma.knowledge.findUnique({
    where: { id },
    include: { remplace: { select: { id: true, title: true } }, remplacePar: { select: { id: true, title: true } } },
  });
  if (!knowledge) {
    return NextResponse.json({ error: "Connaissance introuvable" }, { status: 404 });
  }

  return NextResponse.json(knowledge);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const existante = await prisma.knowledge.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existante) {
    return NextResponse.json({ error: "Connaissance introuvable" }, { status: 404 });
  }

  const body = await req.json();
  const status = typeof body.status === "string" ? body.status : undefined;
  if (status && !(STATUTS_VALIDES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
  }

  const knowledge = await prisma.knowledge.update({
    where: { id },
    data: {
      status: status as (typeof STATUTS_VALIDES)[number] | undefined,
      remplaceId: typeof body.remplaceId === "string" ? body.remplaceId : undefined,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "knowledge.modifiee",
    cible: `knowledge:${id}`,
    detail: `statut ${existante.status} -> ${knowledge.status}`,
  });

  return NextResponse.json(knowledge);
}
