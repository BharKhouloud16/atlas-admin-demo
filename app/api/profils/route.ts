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
    prisma.profil.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} }),
  ]);

  const enrichis = profils.map((p) => ({
    ...p,
    tjmCout: calculerTjmCout(p.type, p.montantSaisi, hyp),
  }));

  return NextResponse.json(enrichis);
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
