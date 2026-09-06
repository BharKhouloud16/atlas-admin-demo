import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { demandeTalentSchema, premierMessageZod } from "@/lib/validation";
import { analyserDemande } from "@/lib/talent/analyseur";

// ATLAS TALENT V1 — fondations. CLIENT -> DEMANDE -> ANALYSE INTELLIGENTE.
// Isolation stricte : un Client ne crée/voit que ses propres demandes (même
// principe que app/api/client/missions), l'Admin voit tout (même principe
// que app/api/missions). Aucun Ingénieur n'a accès à ce module.
//
// L'analyse IA (lib/talent/analyseur.ts, provider-neutre) tourne
// immédiatement à la création, mais son résultat reste une SUGGESTION :
// competencesExtraites/senioriteSouhaitee restent modifiables par l'Admin
// avant tout matching (voir PATCH plus bas et /api/talent/demandes/[id]/matching).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès réservé aux clients" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = demandeTalentSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { titre, description, budgetTjmMax, budgetDevise, dateDebutSouhaitee } = analyse.data;

  // Analyse best-effort : une panne du provider IA ne doit jamais empêcher
  // la création de la demande (l'Admin peut toujours analyser/compléter
  // manuellement ensuite) — cohérent avec lib/audit.ts (journaliser()).
  let suggestion: Awaited<ReturnType<typeof analyserDemande>> | null = null;
  try {
    suggestion = await analyserDemande(description);
  } catch (e) {
    console.error("[talent/demandes] échec de l'AI Request Analyzer, demande créée sans suggestion", e);
  }

  const demande = await prisma.demandeTalent.create({
    data: {
      clientId: session.clientId,
      titre: titre ?? null,
      description,
      budgetTjmMax: budgetTjmMax ?? suggestion?.budgetTjmMax ?? null,
      budgetDevise: budgetDevise ?? suggestion?.budgetDevise ?? "EUR",
      dateDebutSouhaitee: dateDebutSouhaitee ? new Date(dateDebutSouhaitee) : null,
      statut: suggestion ? "ANALYSEE" : "SOUMISE",
      competencesExtraites: suggestion?.competences ?? [],
      senioriteSouhaitee: suggestion?.seniorite ?? null,
      analyseProvider: suggestion?.provider ?? null,
      analyseConfiance: suggestion?.confiance ?? null,
      analyseeLe: suggestion ? new Date() : null,
    },
  });

  return NextResponse.json(demande, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    const demandes = await prisma.demandeTalent.findMany({
      where: { clientId: session.clientId },
      orderBy: { createdAt: "desc" },
      // Un Client voit le statut et les critères de sa propre demande, mais
      // jamais les scores/motifs internes du Matching Engine (réservés à
      // l'Admin tant que la shortlist n'est pas VALIDEE — non exposé ici).
    });
    return NextResponse.json(demandes);
  }

  if (session.role === "ADMIN") {
    const demandes = await prisma.demandeTalent.findMany({
      include: { client: { select: { nom: true } }, _count: { select: { shortlist: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(demandes);
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}
