import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { demandeDepuisBesoinSchema, premierMessageZod } from "@/lib/validation";
import { evaluerEligibiliteBesoin } from "@/lib/client-need/talent-bridge";

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Réservé ADMIN. Crée EXPLICITEMENT une DemandeTalent à partir d'un
// ClientNeed déjà VALIDE (LOT 3) — jamais automatique, jamais déclenché par
// un client ou une IA (directive LOT 5, "principe produit central").
//
// Sécurité :
// - clientId dérivé EXCLUSIVEMENT de `need.clientId` (jamais du body) : un
//   clientId fourni dans le corps de la requête serait de toute façon
//   ignoré, la donnée n'est même pas lue depuis `corps`.
// - Anti-doublon/concurrence : DemandeTalent.sourceNeedId porte une
//   contrainte UNIQUE en base (migration LOT 5) — deux créations
//   concurrentes pour le même besoin produisent une seule ligne, l'autre
//   échoue atomiquement (P2002), jamais une race condition applicative.
// - Aucune IA n'est appelée ici (contrairement à POST /api/talent/demandes)
//   : les champs proviennent d'une relecture humaine explicite du besoin,
//   jamais d'une analyse automatique du texte brut — analyseProvider le
//   documente ("client-need-bridge"), analyseConfiance reste null (aucun
//   score inventé pour une décision humaine).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const need = await prisma.clientNeed.findUnique({ where: { id: params.id } });
  if (!need) {
    return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });
  }

  const eligibilite = evaluerEligibiliteBesoin(need);
  if (!eligibilite.eligible) {
    return NextResponse.json({ error: eligibilite.raison }, { status: 400 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = demandeDepuisBesoinSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  try {
    const demande = await prisma.demandeTalent.create({
      data: {
        clientId: need.clientId,
        sourceNeedId: need.id,
        titre: donnees.titre ?? null,
        description: donnees.description,
        competencesExtraites: donnees.competencesExtraites ?? [],
        senioriteSouhaitee: donnees.senioriteSouhaitee ?? null,
        anneesExperienceMin: donnees.anneesExperienceMin ?? null,
        secteurActivite: donnees.secteurActivite ?? null,
        localisation: donnees.localisation ?? null,
        mobilite: donnees.mobilite ?? null,
        disponibiliteSouhaitee: donnees.disponibiliteSouhaitee ?? null,
        budgetTjmMax: donnees.budgetTjmMax ?? null,
        budgetDevise: donnees.budgetDevise ?? "EUR",
        dateDebutSouhaitee: donnees.dateDebutSouhaitee ? new Date(donnees.dateDebutSouhaitee) : null,
        analyseProvider: "client-need-bridge",
      },
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "talent.demande.creee_depuis_besoin",
      cible: `demande:${demande.id}`,
      detail: `besoin:${need.id} client:${need.clientId}`,
    });

    return NextResponse.json(demande, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existante = await prisma.demandeTalent.findUnique({ where: { sourceNeedId: need.id }, select: { id: true } });
      return NextResponse.json({ error: "Une demande Talent existe déjà pour ce besoin.", demandeTalentId: existante?.id ?? null }, { status: 409 });
    }
    throw e;
  }
}
