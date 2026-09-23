import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const STATUTS_VALIDES = ["UNVERIFIED", "PARTIALLY_VERIFIED", "VERIFIED", "CONFLICTED", "NEEDS_REVIEW", "OUTDATED"] as const;

// ATLAS V1 — Intelligence Foundation. Enregistre un acte de vérification
// sur une ResearchObservation — toujours additif (voir mandat section 8/M :
// une "contradiction" peut être une différence de scope, jamais résolue
// automatiquement). Met à jour le statut dénormalisé de l'observation,
// mais conserve l'historique complet dans ResearchVerification.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const observation = await prisma.researchObservation.findUnique({ where: { id }, select: { id: true } });
  if (!observation) {
    return NextResponse.json({ error: "Observation introuvable" }, { status: 404 });
  }

  const body = await req.json();
  const statut = typeof body.statut === "string" ? body.statut : "";
  if (!(STATUTS_VALIDES as readonly string[]).includes(statut)) {
    return NextResponse.json({ error: "Statut de vérification invalide" }, { status: 400 });
  }

  const [verification] = await prisma.$transaction([
    prisma.researchVerification.create({
      data: {
        observationId: id,
        statut: statut as (typeof STATUTS_VALIDES)[number],
        verifieParEmail: session.email,
        methode: typeof body.methode === "string" ? body.methode.trim() || null : null,
        detail: typeof body.detail === "string" ? body.detail.trim() || null : null,
      },
    }),
    prisma.researchObservation.update({ where: { id }, data: { statutVerification: statut as (typeof STATUTS_VALIDES)[number] } }),
  ]);

  return NextResponse.json(verification, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const verifications = await prisma.researchVerification.findMany({
    where: { observationId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(verifications);
}
