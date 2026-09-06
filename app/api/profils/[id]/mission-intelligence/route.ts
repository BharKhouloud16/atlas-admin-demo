import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireMissionIntelligence, type MissionPourAnalytics, type EvaluationPourAnalytics } from "@/lib/talent/mission-intelligence";

// ATLAS TALENT — Mission Intelligence V1 (Batch 9). Lecture seule : ne
// recalcule ni n'écrit rien (ni Mission, ni Evaluation) — assemble
// uniquement l'historique déjà enregistré, en une seule requête groupée par
// profil (Profil + missions + evaluation), aucun N+1. Réservé Admin, même
// isolation que .../intelligence, .../talent-intelligence et
// .../talent-trust : ces statistiques n'ont de sens que pour un usage
// interne de staffing.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: params.id },
    include: { missions: { include: { evaluation: true } } },
  });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const missions: MissionPourAnalytics[] = profil.missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, createdAt: m.createdAt }));
  const evaluations: EvaluationPourAnalytics[] = profil.missions
    .filter((m) => m.evaluation)
    .map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt }));

  const missionIntelligence = construireMissionIntelligence(profil.id, missions, evaluations);

  return NextResponse.json({ profilId: profil.id, nom: profil.nom, prenom: profil.prenom, missionIntelligence });
}
