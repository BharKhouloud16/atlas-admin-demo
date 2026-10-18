import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §3 ("Visibilité : ... ADMIN voit toutes les sélections de ses
// DemandeTalent"). Route de lecture minimale non détaillée explicitement
// dans la table d'API §15 (qui liste les routes Admin d'Interview/Final
// Decision, pas de lecture des CandidateSelection elles-mêmes) mais requise
// par cette règle de visibilité déjà verrouillée, et nécessaire pour que
// l'Admin puisse choisir un `candidateSelectionId` lors de la planification
// d'un entretien (POST .../interviews). Lecture seule, aucune logique
// métier — jamais une deuxième source de vérité.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const selections = await prisma.candidateSelection.findMany({
    where: { demandeTalentId: params.id },
    include: { shortlistEntree: { include: { profil: { select: { id: true, nom: true, prenom: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ demandeId: params.id, selections });
}
