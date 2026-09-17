import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { listerSolutionsExistantes } from "@/lib/client-solution/generation";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — vue Admin.
//
// Réservé ADMIN, même patron que /api/talent/besoins/[id] (pas
// d'isolation clientId — vue transverse). Lecture seule : ne déclenche
// jamais de génération (réservé au parcours Client, seul déclencheur
// légitime) — renvoie uniquement les SolutionOption déjà persistées, qui
// sont déjà Client-safe (aucune donnée supplémentaire à filtrer ici : rien
// de plus sensible n'est jamais écrit dans SolutionOption, voir
// lib/client-solution/adapter.ts).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const need = await prisma.clientNeed.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!need) {
    return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });
  }

  const lignes = await listerSolutionsExistantes(params.id);
  return NextResponse.json({
    options: lignes.filter((l) => l.niveau === "OPTION"),
    recommandations: lignes.filter((l) => l.niveau === "RECOMMANDATION"),
    decisions: lignes.filter((l) => l.niveau === "DECISION"),
  });
}
