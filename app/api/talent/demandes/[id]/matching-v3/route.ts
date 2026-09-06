import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { classerProfils, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { enrichirMatchingV3 } from "@/lib/talent/matching-v3";

// ATLAS TALENT — Matching Engine V3 : Context & Trust (Batch 7). Lecture
// seule : ne modifie ni ShortlistEntree ni DemandeTalent, ne touche en rien
// au Matching Engine V2 (POST/GET .../matching, lib/talent/matching.ts —
// intégralement préservés, voir lib/talent/matching-v3.ts pour le détail).
// Recalcule le classement V2 à la volée (comme .../recommandations) puis
// l'enrichit de signaux de contexte/confiance/historique/performance pour
// les meilleurs profils — aucune écriture en base, aucun nouveau score
// affiché à la place du score V2. Réservé Admin, même isolation que le
// reste du module Talent.
//
// Requêtes DB groupées (profils, Skill Graph, missions/évaluations) — même
// motif que .../recommandations, aucun N+1.
const NOMBRE_RESULTATS_MAX = 10;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  const profils = await prisma.profil.findMany({
    where: { cvValide: true },
    select: {
      id: true,
      nom: true,
      prenom: true,
      competences: true,
      seniorite: true,
      disponibilite: true,
      cvValide: true,
      tjmEstime: true,
      anneesExperience: true,
      paysResidence: true,
    },
  });
  const profilIds = profils.map((p) => p.id);

  const lignesSkillGraph = await prisma.profilCompetence.findMany({
    where: { profilId: { in: profilIds } },
    include: { preuves: { orderBy: { createdAt: "asc" } } },
  });
  const graphParProfil = new Map<string, CompetenceGraphPourMatching[]>();
  const graphIntelligenceParProfil = new Map<string, ProfilPourIntelligence["competencesGraph"]>();
  for (const ligne of lignesSkillGraph) {
    const pourMatching = graphParProfil.get(ligne.profilId) ?? [];
    pourMatching.push({
      competence: ligne.competence,
      statut: ligne.statut,
      niveau: ligne.niveau,
      confiance: ligne.confiance,
      anneesExperience: ligne.anneesExperience,
      contexte: ligne.contexte,
      provenancePrincipale: ligne.preuves.length > 0 ? ligne.preuves[ligne.preuves.length - 1].source : null,
    });
    graphParProfil.set(ligne.profilId, pourMatching);

    const pourIntelligence = graphIntelligenceParProfil.get(ligne.profilId) ?? [];
    pourIntelligence.push({
      competence: ligne.competence,
      statut: ligne.statut,
      niveau: ligne.niveau,
      confiance: ligne.confiance,
      contexte: ligne.contexte,
      preuves: ligne.preuves.map((p) => ({ source: p.source, detail: p.detail, createdAt: p.createdAt, niveau: p.niveau })),
    });
    graphIntelligenceParProfil.set(ligne.profilId, pourIntelligence);
  }

  const missionsParProfil = await prisma.mission.findMany({
    where: { profilId: { in: profilIds } },
    include: { evaluation: true },
  });
  const missionsMap = new Map<string, typeof missionsParProfil>();
  for (const m of missionsParProfil) {
    const liste = missionsMap.get(m.profilId) ?? [];
    liste.push(m);
    missionsMap.set(m.profilId, liste);
  }

  const profilsAvecSkillGraph: ProfilPourMatching[] = profils.map((p) => ({
    ...p,
    competencesGraph: graphParProfil.get(p.id) ?? [],
  }));

  // Matching Engine V2 — recalculé à la volée, jamais modifié.
  const classement = classerProfils(profilsAvecSkillGraph, {
    competencesRecherchees: demande.competencesExtraites,
    senioriteSouhaitee: demande.senioriteSouhaitee,
    budgetTjmMax: demande.budgetTjmMax,
    anneesExperienceMin: demande.anneesExperienceMin,
    secteurActivite: demande.secteurActivite,
    localisation: demande.localisation,
    mobilite: demande.mobilite,
    disponibiliteSouhaitee: demande.disponibiliteSouhaitee,
  });

  const top = classement.slice(0, NOMBRE_RESULTATS_MAX);
  const profilsParId = new Map(profils.map((p) => [p.id, p]));

  const resultats = top.map((resultatMatching) => {
    const profil = profilsParId.get(resultatMatching.profilId)!;
    const missions = missionsMap.get(profil.id) ?? [];
    const entree: ProfilPourIntelligence = {
      id: profil.id,
      nom: profil.nom,
      prenom: profil.prenom,
      anneesExperience: profil.anneesExperience,
      seniorite: profil.seniorite,
      disponibilite: profil.disponibilite,
      paysResidence: profil.paysResidence,
      cvValide: profil.cvValide,
      competencesDeclarees: profil.competences,
      competencesGraph: graphIntelligenceParProfil.get(profil.id) ?? [],
      missions: missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, secteur: null, createdAt: m.createdAt })),
      evaluations: missions.filter((m) => m.evaluation).map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt })),
    };
    const candidateIntelligence = construireCandidateIntelligence(entree);
    const talentIntelligence = construireTalentIntelligence(candidateIntelligence);
    const matchingV3 = enrichirMatchingV3(resultatMatching, candidateIntelligence, talentIntelligence);
    return { nom: profil.nom, prenom: profil.prenom, ...matchingV3 };
  });

  return NextResponse.json({ demandeId: demande.id, matchingV3: resultats });
}
