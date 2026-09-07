import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireIntelligenceFoundation } from "@/lib/talent/intelligence-foundation";
import type { ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import type { MissionPourAnalytics, EvaluationPourAnalytics } from "@/lib/talent/mission-intelligence";

// ATLAS INTELLIGENCE FOUNDATION V1 (Batch 11). Vue "Profil 360" pour
// l'Admin : Candidate Intelligence + Talent Intelligence + Talent Trust +
// Mission Intelligence en UNE SEULE requête groupée (Profil +
// competencesGraph + preuves + missions + evaluation) — la même forme que
// GET .../intelligence, .../talent-intelligence et .../talent-trust
// réunies, sans les exécuter séparément trois fois. Lecture seule, aucune
// écriture. Réservé Admin, même isolation que le reste du module Talent :
// jamais exposé au Client ni à l'Ingénieur.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: params.id },
    include: {
      competencesGraph: { include: { preuves: { orderBy: { createdAt: "asc" } } }, orderBy: { competence: "asc" } },
      missions: { include: { evaluation: true } },
    },
  });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  // Même mapping, verbatim, que GET .../intelligence, .../talent-intelligence
  // et .../talent-trust — aucune donnée supplémentaire, aucune invention.
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

  // Même mapping, verbatim, que GET .../mission-intelligence.
  const missions: MissionPourAnalytics[] = profil.missions.map((m) => ({ statut: m.statut, nbJours: m.nbJours, createdAt: m.createdAt }));
  const evaluations: EvaluationPourAnalytics[] = profil.missions
    .filter((m) => m.evaluation)
    .map((m) => ({ note: m.evaluation!.note, createdAt: m.evaluation!.createdAt }));

  const foundation = construireIntelligenceFoundation(entree, missions, evaluations);

  return NextResponse.json({ profilId: profil.id, nom: profil.nom, prenom: profil.prenom, foundation });
}
