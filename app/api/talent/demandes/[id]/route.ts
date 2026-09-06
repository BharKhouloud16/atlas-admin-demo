import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { criteresTalentSchema, premierMessageZod } from "@/lib/validation";

// Révision des "critères de matching" d'une DemandeTalent par l'Admin,
// AVANT de lancer le Matching Engine (voir POST .../matching, qui lit ces
// mêmes champs en base — les modifier ici change directement son résultat,
// sans toucher à lib/talent/matching.ts). Réservé à l'Admin : le Client
// voit sa demande (GET /api/talent/demandes) mais ne peut jamais modifier
// les critères internes de matching lui-même (même principe d'isolation
// que app/api/client/missions, qui ne renvoie jamais TJM/marge interne).
const CHAMPS_CRITERES = [
  "competencesExtraites",
  "senioriteSouhaitee",
  "anneesExperienceMin",
  "secteurActivite",
  "localisation",
  "mobilite",
  "disponibiliteSouhaitee",
  "budgetTjmMax",
  "budgetDevise",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = criteresTalentSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const avant = await prisma.demandeTalent.findUnique({ where: { id: params.id } });
  if (!avant) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  const donnees = analyse.data;
  const apres = await prisma.demandeTalent.update({
    where: { id: params.id },
    data: {
      ...donnees,
      criteresModifiesParEmail: session.email,
      criteresModifiesLe: new Date(),
    },
  });

  // Traçabilité avant/après (voir lib/audit.ts) — uniquement les champs
  // réellement envoyés dans la requête, pour un diff lisible.
  const diff = CHAMPS_CRITERES.filter((champ) => champ in donnees)
    .map((champ) => `${champ}: ${JSON.stringify((avant as Record<string, unknown>)[champ])} -> ${JSON.stringify((apres as Record<string, unknown>)[champ])}`)
    .join(" ; ");
  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.criteres.modifies",
    cible: `demande:${params.id}`,
    detail: diff || "aucun champ modifié",
  });

  return NextResponse.json(apres);
}
