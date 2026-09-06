import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { corrigerCompetenceSchema, premierMessageZod } from "@/lib/validation";

// ATLAS SKILL GRAPH V1 — correction humaine explicite d'une ProfilCompetence
// par un Admin (ex: passer une compétence en VERIFIE après un entretien
// technique, ou fixer un niveau 1-5). C'EST LA SEULE ROUTE qui peut faire
// passer un statut à VERIFIE ou fixer un niveau : ni l'IA (lib/talent/
// skill-graph.ts, construireCompetencesInferees) ni le recalcul automatique
// (POST /api/profils/[id]/competences) ne le font jamais. Réservé Admin,
// même isolation que le reste du module Skill Graph.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; competenceId: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = corrigerCompetenceSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const avant = await prisma.profilCompetence.findUnique({ where: { id: params.competenceId } });
  if (!avant || avant.profilId !== params.id) {
    return NextResponse.json({ error: "Compétence introuvable pour ce profil" }, { status: 404 });
  }

  const donnees = analyse.data;
  // Une correction VERIFIE implique toujours une confiance HAUTE (c'est un
  // humain habilité qui tranche) — les autres statuts repassent à une
  // confiance cohérente si l'Admin choisit explicitement de rétrograder une
  // compétence (ex: correction d'une erreur).
  const confiance = donnees.statut === "VERIFIE" ? "HAUTE" : donnees.statut === "INCONNU" ? "BASSE" : "MOYENNE";

  const apres = await prisma.profilCompetence.update({
    where: { id: params.competenceId },
    data: {
      statut: donnees.statut,
      confiance,
      niveau: donnees.niveau ?? (donnees.statut === "VERIFIE" ? avant.niveau : null),
      anneesExperience: donnees.anneesExperience ?? avant.anneesExperience,
      contexte: donnees.contexte ?? avant.contexte,
      secteur: donnees.secteur ?? avant.secteur,
    },
  });

  // La correction elle-même devient une preuve ADMIN — jamais fabriquée :
  // seulement si l'Admin a effectivement agi via cette route.
  // ATLAS DYNAMIC SKILL GRAPH — le niveau fixé par cette correction Admin est
  // désormais aussi enregistré SUR la preuve elle-même (niveau observé par
  // CETTE preuve), en plus du niveau courant sur ProfilCompetence, pour
  // pouvoir reconstituer l'historique (voir niveauxHistoriques() dans
  // lib/talent/skill-graph.ts). Jamais un niveau inventé : uniquement celui
  // explicitement fourni par l'Admin dans cette requête.
  await prisma.skillEvidence.create({
    data: {
      profilCompetenceId: params.competenceId,
      source: "ADMIN",
      detail: donnees.detail ?? `Statut fixé à ${donnees.statut} par ${session.email}`,
      niveau: donnees.niveau ?? null,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.competence.corrigee",
    cible: `profil:${params.id}:competence:${params.competenceId}`,
    detail: `${avant.competence}: statut ${avant.statut} -> ${apres.statut}, niveau ${avant.niveau ?? "null"} -> ${apres.niveau ?? "null"}`,
  });

  return NextResponse.json(apres);
}
