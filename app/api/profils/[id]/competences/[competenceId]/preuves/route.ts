import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { ajouterPreuveSchema, premierMessageZod } from "@/lib/validation";
import { creerPreuveCompetence } from "@/lib/talent/skill-evidence-service";

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

  // Cœur de création extrait dans lib/talent/skill-evidence-service.ts
  // (Phase 2B-1) — comportement strictement identique à l'ancien code
  // inline : même création SkillEvidence, même fusionnerCompetence, même
  // recalcul. Réutilisé aussi par la validation d'une MissionSkillProposal.
  const resultat = await creerPreuveCompetence(prisma, existante, {
    source: donnees.source,
    detail: donnees.detail ?? null,
    niveauObserve: donnees.niveauObserve ?? null,
    statutPropose: donnees.statutPropose,
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.competence.preuveAjoutee",
    cible: `profil:${params.id}:competence:${params.competenceId}`,
    detail: `${existante.competence}: preuve ${donnees.source} ajoutée (statut ${existante.statut} -> ${resultat.profilCompetence.statut}, niveau ${existante.niveau ?? "null"} -> ${resultat.profilCompetence.niveau ?? "null"})`,
  });

  return NextResponse.json({
    ...resultat.profilCompetence,
    preuves: resultat.preuves,
    confianceDetaillee: resultat.confianceDetaillee,
    niveauxHistoriques: resultat.niveauxHistoriques,
  });
}
