import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

// ATLAS V1 — Intelligence Foundation (23/09/2026). Research Engine :
// point d'entrée d'une recherche professionnelle (voir mandat sections
// 16-17). Réservé Admin — même discipline que /api/service-engagements
// (Phase 7) : aucun ajout à middleware.ts, vérification RBAC au niveau du
// handler uniquement (pattern déjà établi pour les routes de fondation).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "La question est requise" }, { status: 400 });
  }

  const query = await prisma.researchQuery.create({
    data: {
      question,
      contexte: typeof body.contexte === "string" ? body.contexte.trim() || null : null,
      demandeParEmail: session.email,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "research.query.creee",
    cible: `researchQuery:${query.id}`,
    detail: query.question,
  });

  return NextResponse.json(query, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const queries = await prisma.researchQuery.findMany({
    select: {
      id: true,
      question: true,
      contexte: true,
      demandeParEmail: true,
      statut: true,
      createdAt: true,
      _count: { select: { sources: true, observations: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(queries);
}
