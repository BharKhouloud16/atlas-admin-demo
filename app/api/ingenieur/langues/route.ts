import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { langueSchema, premierMessageZod } from "@/lib/validation";

// ENGINEER PROFILE V2 — Lot 5. Même discipline que /api/ingenieur/
// certifications : auto-déclaration Ingénieur (statut DECLARE, source
// PROFIL), jamais VERIFIE automatiquement. Upsert sur (profilId, langue) —
// une langue déjà déclarée voit son niveau mis à jour plutôt que dupliquée
// (voir @@unique([profilId, langue]), prisma/schema.prisma) ; une mise à
// jour DECLARE ne fait jamais régresser une langue déjà VERIFIE par un Admin
// (même règle de non-régression que le Skill Graph, voir
// lib/talent/skill-graph.ts::fusionnerCompetence — ici appliquée directement
// puisqu'il n'existe qu'un seul statut par langue, jamais un historique de
// statuts concurrents à fusionner).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const langues = await prisma.langueParlee.findMany({
    where: { profilId: session.profilId },
    orderBy: { langue: "asc" },
  });
  return NextResponse.json(langues);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = langueSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  const existante = await prisma.langueParlee.findUnique({
    where: { profilId_langue: { profilId: session.profilId, langue: donnees.langue } },
  });
  // Ne jamais faire régresser une langue déjà VERIFIE par un Admin via une
  // simple re-déclaration Ingénieur.
  if (existante && existante.statut === "VERIFIE") {
    return NextResponse.json({ error: "Cette langue a déjà été vérifiée par un administrateur et ne peut pas être modifiée ici." }, { status: 409 });
  }

  const langue = await prisma.langueParlee.upsert({
    where: { profilId_langue: { profilId: session.profilId, langue: donnees.langue } },
    create: {
      profilId: session.profilId,
      langue: donnees.langue,
      niveau: donnees.niveau ?? null,
      source: "PROFIL",
      statut: "DECLARE",
      detail: donnees.detail ?? null,
    },
    update: {
      niveau: donnees.niveau ?? null,
      detail: donnees.detail ?? null,
    },
  });

  return NextResponse.json(langue, { status: 201 });
}
