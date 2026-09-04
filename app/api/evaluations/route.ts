import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { envoyerEmailNouvelleEvaluation } from "@/lib/email";

// Évaluations client des missions terminées — voir prisma/schema.prisma
// (Evaluation, 1 par mission) et app/client/page.tsx. Alimente les
// statistiques personnelles de l'ingénieur (voir /api/ingenieur/profil) et,
// à titre informatif, le tableau Admin (/admin/profils) — n'entre pas dans
// le calcul du score (lib/scoring.ts) pour ne pas pénaliser les profils
// sans historique de mission.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (session.role === "CLIENT") {
    if (!session.clientId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    const missions = await prisma.mission.findMany({
      where: { clientId: session.clientId, statut: "Terminée" },
      select: {
        id: true,
        repere: true,
        profil: { select: { nom: true } },
        evaluation: { select: { note: true, commentaire: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ missions });
  }

  if (session.role === "ADMIN") {
    const evaluations = await prisma.evaluation.findMany({
      include: { mission: { include: { client: true, profil: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ evaluations });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const { missionId, note, commentaire } = body;
  const noteNombre = Number(note);
  if (!missionId || !Number.isInteger(noteNombre) || noteNombre < 1 || noteNombre > 5) {
    return NextResponse.json({ error: "Note invalide (1 à 5)." }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.clientId !== session.clientId) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }
  if (mission.statut !== "Terminée") {
    return NextResponse.json({ error: "Seule une mission terminée peut être évaluée." }, { status: 400 });
  }

  const existante = await prisma.evaluation.findUnique({ where: { missionId } });
  if (existante) {
    return NextResponse.json({ error: "Cette mission a déjà été évaluée." }, { status: 409 });
  }

  const evaluation = await prisma.evaluation.create({
    data: { missionId, note: noteNombre, commentaire: commentaire?.trim() || null },
  });

  const compteIngenieur = await prisma.user.findUnique({
    where: { profilId: mission.profilId },
    include: { profil: true },
  });
  if (compteIngenieur) {
    await envoyerEmailNouvelleEvaluation({
      to: compteIngenieur.email,
      nom: compteIngenieur.profil?.nom ?? "",
      mission: mission.repere ?? mission.id,
      note: noteNombre,
    });
  }

  return NextResponse.json(evaluation, { status: 201 });
}
