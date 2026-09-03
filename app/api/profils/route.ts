import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Reproduit exactement la formule de l'onglet "Profils" du fichier Excel.
// Un profil créé par auto-inscription n'a pas encore de type/montant tant
// que l'Admin ne l'a pas validé (voir /api/comptes) : on renvoie null plutôt
// que de planter, pour ne rien casser côté missions en attendant.
export function calculerTjmCout(
  type: "SALARIE" | "FREELANCE" | "PORTAGE" | null,
  montant: number | null,
  hyp: { joursAn: number; chargesSalarie: number; fraisFreelance: number }
): number | null {
  if (!type || montant == null) return null;
  if (type === "SALARIE") return (montant * (1 + hyp.chargesSalarie)) / hyp.joursAn;
  if (type === "PORTAGE") return montant;
  return montant * (1 + hyp.fraisFreelance); // FREELANCE
}

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
