import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Toutes les données affichées sur la page profil de l'ingénieur
// (voir /ingenieur) : informations issues du CV, disponibilité, missions
// avec Atlas, et référence au CV importé.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: {
      nom: true,
      prenom: true,
      type: true,
      cvNomFichier: true,
      cvImporteLe: true,
      cvValide: true,
      disponibilite: true,
      disponibilitePrevue: true,
      changerMissionActuelle: true,
      missionApres: true,
      preavis: true,
      preavisPrecision: true,
      nationalite: true,
      nationalitePrecision: true,
      paysResidence: true,
      paysResidencePrecision: true,
      regimeSuggere: true,
      tjmSouhaite: true,
      tjmSouhaiteDevise: true,
      disponibiliteRenseigneeLe: true,
      questionnaireValide: true,
      competences: true,
      entretiensRealises: true,
      createdAt: true,
      infosCv: { orderBy: { ordre: "asc" } },
      missions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          repere: true,
          statut: true,
          nbJours: true,
          createdAt: true,
          updatedAt: true,
          client: { select: { nom: true, pays: true } },
        },
      },
    },
  });

  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  // Note client moyenne (voir Evaluation dans prisma/schema.prisma) —
  // affichée dans les statistiques personnelles (EspaceIngenieur.tsx),
  // jamais utilisée pour bloquer ou pénaliser un profil sans historique.
  const agregatEvaluations = await prisma.evaluation.aggregate({
    where: { mission: { profilId: session.profilId } },
    _avg: { note: true },
    _count: { note: true },
  });

  return NextResponse.json({
    ...profil,
    evaluationMoyenne: agregatEvaluations._avg.note,
    nombreEvaluations: agregatEvaluations._count.note,
  });
}
