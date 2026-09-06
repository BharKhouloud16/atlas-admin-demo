import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { ajouterPreuveSchema, premierMessageZod } from "@/lib/validation";
import { fusionnerCompetence, niveauxHistoriques } from "@/lib/talent/skill-graph";
import { calculerConfianceCompetence } from "@/lib/talent/evidence-confidence";

// ATLAS DYNAMIC SKILL GRAPH — ajoute une nouvelle preuve (SkillEvidence) à
// une ProfilCompetence existante SANS JAMAIS supprimer ni écraser une preuve
// précédente (voir prisma/schema.prisma, SkillEvidence — historique
// immuable, événement par événement). C'est la deuxième voie légitime,
// après PATCH .../competences/[competenceId] (correction complète), pour
// enrichir une compétence : celle-ci sert à ACCUMULER une preuve
// supplémentaire (ex: une nouvelle mission, une nouvelle évaluation) sans
// nécessairement changer le statut. Réservé Admin, même isolation que le
// reste du module Skill Graph (voir route soeur PATCH pour le pattern).
//
// `statutPropose`/`niveauObserve` ne sont jamais appliqués tels quels : ils
// passent par fusionnerCompetence(), qui ne fait JAMAIS régresser un statut
// déjà plus fort (ex: une preuve DECLARE n'écrase jamais un VERIFIE déjà
// acquis) — exactement la même règle que POST /api/profils/[id]/competences.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; competenceId: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = ajouterPreuveSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const existante = await prisma.profilCompetence.findUnique({ where: { id: params.competenceId } });
  if (!existante || existante.profilId !== params.id) {
    return NextResponse.json({ error: "Compétence introuvable pour ce profil" }, { status: 404 });
  }

  const donnees = analyse.data;

  // La nouvelle preuve est TOUJOURS créée, quelle que soit la suite —
  // l'historique s'accumule, il ne se substitue jamais à ce qui précède.
  await prisma.skillEvidence.create({
    data: {
      profilCompetenceId: params.competenceId,
      source: donnees.source,
      detail: donnees.detail ?? null,
      niveau: donnees.niveauObserve ?? null,
    },
  });

  // Fusion éventuelle du statut/niveau proposés avec l'existant — jamais de
  // régression (voir fusionnerCompetence, lib/talent/skill-graph.ts).
  // Lorsqu'aucun statutPropose n'est fourni, on ne compare qu'un niveau
  // éventuel : le statut existant est réutilisé comme "nouvelle" entrée pour
  // ne jamais le faire bouger involontairement.
  const resultat = fusionnerCompetence(
    { competence: existante.competence, statut: existante.statut, confiance: existante.confiance, niveau: existante.niveau },
    {
      competence: existante.competence,
      statut: donnees.statutPropose ?? existante.statut,
      confiance: existante.confiance,
      niveau: donnees.niveauObserve ?? null,
      anneesExperience: existante.anneesExperience,
      contexte: existante.contexte,
      secteur: existante.secteur,
      preuve: { source: donnees.source, detail: donnees.detail ?? null, niveau: donnees.niveauObserve ?? null },
    }
  );

  const apres = await prisma.profilCompetence.update({
    where: { id: params.competenceId },
    data: { statut: resultat.statut, confiance: resultat.confiance, niveau: resultat.niveau },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.competence.preuveAjoutee",
    cible: `profil:${params.id}:competence:${params.competenceId}`,
    detail: `${existante.competence}: preuve ${donnees.source} ajoutée (statut ${existante.statut} -> ${apres.statut}, niveau ${existante.niveau ?? "null"} -> ${apres.niveau ?? "null"})`,
  });

  const preuves = await prisma.skillEvidence.findMany({
    where: { profilCompetenceId: params.competenceId },
    orderBy: { createdAt: "asc" },
  });

  const confianceDetaillee = calculerConfianceCompetence({
    competence: apres.competence,
    statut: apres.statut,
    niveau: apres.niveau,
    confiance: apres.confiance,
    contexte: apres.contexte,
    preuves,
  });

  return NextResponse.json({
    ...apres,
    preuves,
    confianceDetaillee,
    niveauxHistoriques: niveauxHistoriques(preuves.map((p) => ({ niveau: p.niveau, source: p.source, createdAt: p.createdAt }))),
  });
}
