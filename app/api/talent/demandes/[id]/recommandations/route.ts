import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { classerProfils, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireRecommandation } from "@/lib/talent/recommendation-engine";

// ATLAS TALENT — Talent Recommendation Engine V1 (Batch 6). Lecture seule :
// ne modifie ni ShortlistEntree ni DemandeTalent (contrairement au POST
// .../matching, qui persiste une shortlist) — recalcule le classement du
// Matching Engine V2 à la volée (déterministe, sans coût IA, voir
// lib/talent/matching.ts) puis l'enrichit de Candidate/Talent Intelligence
// pour les meilleurs profils, sans jamais écrire en base. Réservé Admin,
// même isolation que POST/GET .../matching et .../intelligence : une
// recommandation explique un raisonnement interne de staffing (contradictions,
// preuves faibles) qui n'a pas vocation à être vu par le Client ni
// l'Ingénieur.
//
// Toutes les requêtes DB sont groupées (un findMany pour les profils
// candidats, un findMany pour leur Skill Graph, un findMany pour leurs
// missions/évaluations) — aucun N+1 même avec un grand nombre de profils.
const NOMBRE_RECOMMANDATIONS_MAX = 10;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  // Même périmètre que POST .../matching : seuls les profils au dossier
  // exploitable (CV validé) sont candidats à une recommandation.
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

  // Matching Engine V2 — recalculé à la volée, jamais modifié ni persisté
  // ici (voir commentaire de tête).
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

  const top = classement.slice(0, NOMBRE_RECOMMANDATIONS_MAX);
  const profilsParId = new Map(profils.map((p) => [p.id, p]));

  const recommandations = top.map((resultatMatching) => {
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
    const recommandation = construireRecommandation(resultatMatching, candidateIntelligence, talentIntelligence, demande.competencesExtraites);
    return { nom: profil.nom, prenom: profil.prenom, ...recommandation };
  });

  return NextResponse.json({ demandeId: demande.id, recommandations });
}
