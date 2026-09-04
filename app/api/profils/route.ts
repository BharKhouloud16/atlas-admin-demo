import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { calculerTjmCout } from "@/lib/calculs";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const [profils, hyp] = await Promise.all([
    // include compte.desactive : un ingénieur ayant désactivé temporairement
    // son profil (voir /ingenieur -> "Mon compte") doit devenir invisible
    // dans le matching admin, comme annoncé côté ingénieur — voir le filtre
    // juste en dessous.
    prisma.profil.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        compte: { select: { desactive: true } },
        // Pour le badge de confiance calculé (voir lib/scoring.ts,
        // calculerBadgeConfiance) — affiché dans le panneau de détail de
        // chaque profil sur /admin/profils.
        missions: { select: { statut: true, evaluation: { select: { note: true } } } },
      },
    }),
    prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} }),
  ]);

  const visibles = profils.filter((p) => !p.compte?.desactive);

  const enrichis = visibles.map(({ compte, missions, ...p }) => {
    const evaluations = missions.map((m) => m.evaluation?.note).filter((n): n is number => n != null);
    const evaluationMoyenne = evaluations.length > 0 ? evaluations.reduce((s, n) => s + n, 0) / evaluations.length : null;
    return {
      ...p,
      tjmCout: calculerTjmCout(p.type, p.montantSaisi, hyp),
      missionsTerminees: missions.filter((m) => m.statut === "Terminée").length,
      evaluationMoyenne,
      nombreEvaluations: evaluations.length,
    };
  });

  return NextResponse.json({ profils: enrichis, nombreDesactives: profils.length - visibles.length });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  if (!body.nom || !body.type || body.montantSaisi == null) {
    return NextResponse.json({ error: "Nom, type et montant requis" }, { status: 400 });
  }

  const profil = await prisma.profil.create({
    data: { nom: body.nom, type: body.type, montantSaisi: body.montantSaisi },
  });
  return NextResponse.json(profil, { status: 201 });
}

// Édition rapide d'un champ ponctuel depuis le tableau de matching (voir
// /admin/profils) — pour l'instant uniquement entretiensRealises, saisi
// manuellement par l'Admin faute de module de gestion des entretiens dédié.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  const { id, entretiensRealises } = body;
  if (!id || typeof entretiensRealises !== "number" || entretiensRealises < 0) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  await prisma.profil.update({
    where: { id },
    data: { entretiensRealises: Math.round(entretiensRealises) },
  });
  return NextResponse.json({ ok: true });
}
