import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { lierCompetenceMissionSchema, premierMessageZod } from "@/lib/validation";
import { fusionnerCompetence, niveauxHistoriques } from "@/lib/talent/skill-graph";
import { calculerConfianceCompetence } from "@/lib/talent/evidence-confidence";

// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 2.
//
// Objectif stratégique du mandat CEO : transformer Mission -> Engineer en
// Mission -> Engineer -> Compétences utilisées. Cette route est la SEULE
// voie d'écriture de MissionCompetence (voir prisma/schema.prisma) : Admin
// uniquement, exactement la même isolation que le reste du Skill Graph (voir
// app/api/profils/[id]/competences/[competenceId]/preuves/route.ts, dont
// cette route reprend la logique quasi à l'identique).
//
// NE FABRIQUE JAMAIS de ProfilCompetence : `profilCompetenceId` doit déjà
// exister sur le Skill Graph de l'ingénieur de la mission (via POST
// /api/profils/[id]/competences ou une correction Admin) — sinon 404.
// Vérifie explicitement que la ProfilCompetence appartient au MÊME profil
// que la Mission (jamais une association arbitraire entre une compétence et
// la mission d'un autre Engineer — exigence sécurité explicite du mandat).
//
// La preuve MISSION créée ici passe par fusionnerCompetence() comme
// n'importe quelle autre preuve — aucun nouveau statut de provenance, aucune
// règle de fusion différente : jamais de régression d'un statut plus fort.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true, profilId: true } });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const corps = await req.json();
  const analyse = lierCompetenceMissionSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  // IDOR/BOLA — la compétence DOIT appartenir au même profil que la
  // mission : jamais une association arbitraire entre la compétence d'un
  // Engineer et la mission d'un autre. 404 (pas 403) pour ne jamais
  // confirmer l'existence d'une compétence sur un profil tiers.
  const competence = await prisma.profilCompetence.findUnique({ where: { id: donnees.profilCompetenceId } });
  if (!competence || competence.profilId !== mission.profilId) {
    return NextResponse.json({ error: "Compétence introuvable pour l'ingénieur de cette mission" }, { status: 404 });
  }

  const dejaLiee = await prisma.missionCompetence.findUnique({
    where: { missionId_profilCompetenceId: { missionId: mission.id, profilCompetenceId: competence.id } },
  });
  if (dejaLiee) {
    return NextResponse.json({ error: "Cette compétence est déjà reliée à cette mission" }, { status: 409 });
  }

  await prisma.missionCompetence.create({
    data: { missionId: mission.id, profilCompetenceId: competence.id, creeParEmail: session.email },
  });

  // Preuve MISSION toujours créée, additive — jamais de suppression d'une
  // preuve précédente (même règle que .../competences/[id]/preuves).
  await prisma.skillEvidence.create({
    data: {
      profilCompetenceId: competence.id,
      source: "MISSION",
      detail: donnees.detail ?? `Compétence mobilisée sur la mission ${mission.id}`,
      niveau: donnees.niveauObserve ?? null,
    },
  });

  const resultat = fusionnerCompetence(
    { competence: competence.competence, statut: competence.statut, confiance: competence.confiance, niveau: competence.niveau },
    {
      competence: competence.competence,
      statut: donnees.statutPropose ?? competence.statut,
      confiance: competence.confiance,
      niveau: donnees.niveauObserve ?? null,
      anneesExperience: competence.anneesExperience,
      contexte: competence.contexte,
      secteur: competence.secteur,
      preuve: { source: "MISSION", detail: donnees.detail ?? null, niveau: donnees.niveauObserve ?? null },
    }
  );

  const apres = await prisma.profilCompetence.update({
    where: { id: competence.id },
    data: { statut: resultat.statut, confiance: resultat.confiance, niveau: resultat.niveau },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.competence.missionLiee",
    cible: `mission:${mission.id}:competence:${competence.id}`,
    detail: `${competence.competence}: reliée à la mission ${mission.id} (statut ${competence.statut} -> ${apres.statut})`,
  });

  const preuves = await prisma.skillEvidence.findMany({
    where: { profilCompetenceId: competence.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    ...apres,
    preuves,
    confianceDetaillee: calculerConfianceCompetence({
      competence: apres.competence,
      statut: apres.statut,
      niveau: apres.niveau,
      confiance: apres.confiance,
      contexte: apres.contexte,
      preuves,
    }),
    niveauxHistoriques: niveauxHistoriques(preuves.map((p) => ({ niveau: p.niveau, source: p.source, createdAt: p.createdAt }))),
  });
}

// Liste les compétences reliées à CETTE mission — lecture Admin seule (même
// isolation que le reste du Skill Graph), utilisée par la fiche complète
// (voir GET /api/profils/[id]/fiche-complete, Lot 1) et par toute UI mission.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const liens = await prisma.missionCompetence.findMany({
    where: { missionId: params.id },
    include: { profilCompetence: { select: { id: true, competence: true, statut: true, niveau: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ missionId: params.id, competences: liens });
}
