import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { calculerBadgeConfiance } from "@/lib/scoring";

// Un client ne voit jamais que ses propres missions, et jamais de données
// tarifaires internes (TJM coût, marge) — seulement le suivi opérationnel.
// Depuis peu, on expose aussi côté client un aperçu "vitrine" du profil de
// l'ingénieur (portfolio de réalisations, badge de confiance, vidéo de
// présentation) — jamais de score de matching ni de TJM, réservés à l'Admin.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const missions = await prisma.mission.findMany({
    where: { clientId: session.clientId },
    select: {
      id: true,
      repere: true,
      statut: true,
      nbJours: true,
      createdAt: true,
      profil: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          realisations: true,
          videoUrl: true,
          missions: { select: { statut: true, evaluation: { select: { note: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const enrichies = missions.map((m) => {
    const { missions: missionsProfil, videoUrl, ...profilBase } = m.profil;
    const evaluations = missionsProfil.map((mp) => mp.evaluation?.note).filter((n): n is number => n != null);
    const evaluationMoyenne = evaluations.length > 0 ? evaluations.reduce((s, n) => s + n, 0) / evaluations.length : null;
    const missionsTerminees = missionsProfil.filter((mp) => mp.statut === "Terminée").length;
    const badge = calculerBadgeConfiance({ evaluationMoyenne, nombreEvaluations: evaluations.length, missionsTerminees });
    return {
      ...m,
      profil: { ...profilBase, badge, aVideo: Boolean(videoUrl) },
    };
  });

  return NextResponse.json(enrichies);
}
