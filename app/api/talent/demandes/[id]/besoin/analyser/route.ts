import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { analyserBesoinSchema, premierMessageZod } from "@/lib/validation";
import { analyserBesoinLibre } from "@/lib/talent/requirement-analyzer";

// ATLAS LOT 15.5 — Client Requirement Builder, Mode 1 (Expression libre).
// Propose une lecture structurée du texte du Client (IA si ANTHROPIC_API_KEY
// est configurée, sinon heuristique locale — voir
// lib/talent/requirement-analyzer.ts) SANS RIEN PERSISTER : "l'IA propose,
// le Client décide" (Partie E du mandat) — voir PATCH .../besoin pour la
// confirmation explicite qui, seule, écrit en base.
//
// Réservé au Client propriétaire de la demande — même principe d'isolation
// que app/api/client/missions (filtre clientId dans le WHERE, jamais un
// 403 après coup qui révélerait l'existence d'une demande d'un autre
// client).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès réservé aux clients" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.id, clientId: session.clientId },
    select: { id: true },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  const corps = await req.json().catch(() => ({}));
  const analyse = analyserBesoinSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const requirement = await analyserBesoinLibre(analyse.data.description);
  return NextResponse.json({ requirement });
}
