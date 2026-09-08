import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// LE seul point de décision humaine de la boucle d'amélioration continue :
// approuver ou rejeter une proposition, avec motif obligatoire. Ceci reste
// une DÉCISION, pas une APPLICATION — approuver une proposition ici ne
// déclenche aucune modification automatique de permission, de règle ou de
// donnée (voir directive B16, section 6 : "Elle ne modifie jamais seule").
// Réservé ADMIN.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const decision = body.decision;
    const motifDecision = typeof body.motifDecision === "string" ? body.motifDecision.trim() : "";
    if (decision !== "APPROUVEE" && decision !== "REJETEE") {
      return NextResponse.json({ error: "decision doit être APPROUVEE ou REJETEE." }, { status: 400 });
    }
    if (!motifDecision) {
      return NextResponse.json({ error: "motifDecision est requis pour toute décision." }, { status: 400 });
    }

    const existante = await prisma.propositionSecurite.findUnique({ where: { id: params.id } });
    if (!existante) {
      return NextResponse.json({ error: "Proposition introuvable." }, { status: 404 });
    }
    if (existante.statut !== "PROPOSEE") {
      return NextResponse.json({ error: "Cette proposition a déjà été décidée." }, { status: 409 });
    }

    const proposition = await prisma.propositionSecurite.update({
      where: { id: params.id },
      data: {
        statut: decision,
        decideParEmail: session.email,
        decideLe: new Date(),
        motifDecision,
      },
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: decision === "APPROUVEE" ? "approbation_proposition_securite" : "rejet_proposition_securite",
      cible: proposition.id,
      detail: motifDecision,
    });

    return NextResponse.json(proposition);
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la décision sur la proposition." }, { status: 500 });
  }
}
