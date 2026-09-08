import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Interface OBSERVE -> ANALYSE -> PROPOSE -> VALIDATION HUMAINE (directive
// B16, section 6) : une PropositionSecurite ne modifie JAMAIS rien par
// elle-même — ni permission, ni règle de sécurité, ni donnée. Elle décrit
// une amélioration suggérée (par un Admin ayant observé un signal via
// /api/security/runtime, ou manuellement) et reste à l'état PROPOSEE
// jusqu'à décision explicite (voir PATCH sur
// /api/security/propositions/[id]). AUCUNE route de ce lot n'applique
// automatiquement une proposition — voir rapport final, section limites.
// Réservé ADMIN (même périmètre que le reste de /api/security).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  try {
    const propositions = await prisma.propositionSecurite.findMany({ orderBy: { proposeLe: "desc" }, take: 100 });
    return NextResponse.json({ propositions });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des propositions." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const origine = typeof body.origine === "string" ? body.origine.trim() : "";
    const titre = typeof body.titre === "string" ? body.titre.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!origine || !titre || !description) {
      return NextResponse.json({ error: "origine, titre et description sont requis." }, { status: 400 });
    }

    const proposition = await prisma.propositionSecurite.create({
      data: { origine, titre, description, proposeParEmail: session.email },
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "creation_proposition_securite",
      cible: proposition.id,
      detail: `Proposition créée : ${titre}`,
    });

    return NextResponse.json(proposition, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création de la proposition." }, { status: 500 });
  }
}
