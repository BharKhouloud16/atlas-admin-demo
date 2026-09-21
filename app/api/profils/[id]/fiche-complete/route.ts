import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireIntelligenceFoundation } from "@/lib/talent/intelligence-foundation";
import type { ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import type { MissionPourAnalytics, EvaluationPourAnalytics } from "@/lib/talent/mission-intelligence";
import { calculerConfianceCompetences } from "@/lib/talent/evidence-confidence";
import { niveauxHistoriques } from "@/lib/talent/skill-graph";
import { construireMemoireProfessionnelle, type MissionPourMemoire } from "@/lib/talent/professional-memory";
import { evaluerFraicheurDisponibilite, explicationFraicheurDisponibilite } from "@/lib/talent/disponibilite-fraicheur";

// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 1.
//
// Objectif du mandat CEO : "Supprimer le fossé actuel entre /admin/profils
// et /admin/talent/[id]. Un Admin doit pouvoir partir d'un candidat
// shortlisté et accéder immédiatement à une vision complète de son profil
// professionnel." — sans nouvelle architecture de matching : cette route
// COMPOSE uniquement des moteurs déjà existants et déjà testés
// (construireIntelligenceFoundation, reprise VERBATIM de GET .../
// intelligence-foundation ; calculerConfianceCompetences ; niveauxHistoriques ;
// construireMemoireProfessionnelle, Lot 2 ; evaluerFraicheurDisponibilite,
// Lot 4) — zéro nouveau moteur Trust/Matching/Recommendation.
//
// UNE seule requête Prisma groupée (+ une deuxième pour les liens
// MissionCompetence, non-N+1 — un seul appel, jamais un par compétence) :
// jamais N+1. Réservé Admin, même isolation stricte que le reste du module
// Talent (jamais exposé au Client ni à l'Ingénieur — Skill Graph, Trust,
// TJM interne, motifs de matching).
//
// Le "Matching" (facteurs/motifs d'une ShortlistEntree précise) n'est PAS
// recalculé ici : il dépend d'une DemandeTalent donnée et est déjà disponible
// côté client (voir GET /api/talent/demandes/[id]/matching, déjà appelé par
// /admin/talent/[id]) — le composer une seconde fois ici dupliquerait un
// calcul déjà fait pour rien. Cette route fournit tout le RESTE (identité,
// Skill Graph, Evidence, Trust, Freshness, missions, Professional Memory,
// Certifications, Langues) que l'Admin ouvrait auparavant séparément.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: params.id },
    include: {
      competencesGraph: { include: { preuves: { orderBy: { createdAt: "asc" } } }, orderBy: { competence: "asc" } },
      missions: { include: { evaluation: true }, orderBy: { createdAt: "desc" } },
      certifications: { orderBy: { createdAt: "desc" } },
      langues: { orderBy: { langue: "asc" } },
    },
  });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  // Même mapping verbatim que GET .../intelligence-foundation — réutilise le
  // moteur existant tel quel, aucune duplication de logique Trust/Intelligence.
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
    competencesGraph: profil.competencesGraph.map((c) => ({
      competence: c.competence,
      statut: c.statut,
      niveau: c.niveau,
      confiance: c.confiance,
      contexte: c.contexte,
      preuves: c.preuves.map((p) => ({ source: p.source, detail: p.detail, createdAt: p.createdAt, niveau: p.niveau })),
    })),
    missions: profil.missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, secteur: null, createdAt: m.createdAt })),
    evaluations: profil.missions.filter((m) => m.evaluation).map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt })),
  };
  const missionsAnalytics: MissionPourAnalytics[] = profil.missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, createdAt: m.createdAt }));
  const evaluationsAnalytics: EvaluationPourAnalytics[] = profil.missions
    .filter((m) => m.evaluation)
    .map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt }));

  const foundation = construireIntelligenceFoundation(entree, missionsAnalytics, evaluationsAnalytics);

  // Evidence Confidence détaillée par compétence — même calcul, verbatim,
  // que GET /api/profils/[id]/competences.
  const confiances = calculerConfianceCompetences(
    profil.competencesGraph.map((c) => ({
      competence: c.competence,
      statut: c.statut,
      niveau: c.niveau,
      confiance: c.confiance,
      contexte: c.contexte,
      preuves: c.preuves.map((p) => ({ source: p.source, detail: p.detail, createdAt: p.createdAt, niveau: p.niveau })),
    }))
  );
  const competences = profil.competencesGraph.map((c, i) => ({
    id: c.id,
    competence: c.competence,
    statut: c.statut,
    niveau: c.niveau,
    confiance: c.confiance,
    anneesExperience: c.anneesExperience,
    contexte: c.contexte,
    secteur: c.secteur,
    preuves: c.preuves,
    confianceDetaillee: confiances[i],
    niveauxHistoriques: niveauxHistoriques(c.preuves.map((p) => ({ niveau: p.niveau, source: p.source, createdAt: p.createdAt }))),
  }));

  // ENGINEER PROFILE V2 — Lot 2 : Professional Memory. Une seule requête
  // groupée supplémentaire (jamais une par compétence) — filtrée par les
  // ProfilCompetence de CE profil uniquement (jamais les liens d'un autre
  // Engineer).
  const liensMission = await prisma.missionCompetence.findMany({
    where: { profilCompetence: { profilId: profil.id } },
    select: { missionId: true, profilCompetenceId: true, creeParEmail: true, createdAt: true },
  });
  const missionsParId = new Map<string, MissionPourMemoire>(
    profil.missions.map((m) => [
      m.id,
      {
        id: m.id,
        repere: m.repere,
        statut: m.statut,
        dateDebut: m.dateDebut ? m.dateDebut.toISOString() : null,
        dateFin: m.dateFin ? m.dateFin.toISOString() : null,
        evaluation: m.evaluation ? { note: m.evaluation.note, commentaire: m.evaluation.commentaire } : null,
      },
    ])
  );
  const competencesParId = new Map(profil.competencesGraph.map((c) => [c.id, c.competence]));
  const memoireProfessionnelle = construireMemoireProfessionnelle(
    liensMission.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    missionsParId,
    competencesParId
  );

  // ENGINEER PROFILE V2 — Lot 4 : fraîcheur de la disponibilité (n'affecte
  // jamais la valeur déclarée elle-même, purement informatif).
  const maintenant = new Date();
  const fraicheurDisponibilite = evaluerFraicheurDisponibilite(profil.disponibiliteRenseigneeLe, maintenant);
  const joursDepuisDisponibilite = profil.disponibiliteRenseigneeLe
    ? Math.floor((maintenant.getTime() - profil.disponibiliteRenseigneeLe.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return NextResponse.json({
    profilId: profil.id,
    identite: {
      nom: profil.nom,
      prenom: profil.prenom,
      seniorite: profil.seniorite,
      anneesExperience: profil.anneesExperience,
      disponibilite: profil.disponibilite,
      disponibiliteRenseigneeLe: profil.disponibiliteRenseigneeLe ? profil.disponibiliteRenseigneeLe.toISOString() : null,
      fraicheurDisponibilite,
      explicationFraicheurDisponibilite: explicationFraicheurDisponibilite(fraicheurDisponibilite, joursDepuisDisponibilite),
      paysResidence: profil.paysResidence,
      cvValide: profil.cvValide,
    },
    skillGraph: competences,
    certifications: profil.certifications,
    langues: profil.langues,
    missions: profil.missions.map((m) => ({
      id: m.id,
      repere: m.repere,
      statut: m.statut,
      nbJours: m.nbJours,
      dateDebut: m.dateDebut,
      dateFin: m.dateFin,
      evaluation: m.evaluation,
    })),
    memoireProfessionnelle,
    foundation,
  });
}
