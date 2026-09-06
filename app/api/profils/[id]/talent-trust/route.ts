import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireTalentTrust } from "@/lib/talent/talent-trust";

// ATLAS TRUST / ATLAS TALENT — Talent Trust V2 (Batch 8). Lecture seule :
// ne recalcule ni n'écrit rien (ni Skill Graph, ni Evidence Confidence, ni
// Profil) — assemble uniquement ce qui existe déjà, en une seule requête
// groupée par profil (même motif que GET .../intelligence et
// .../talent-intelligence). Réservé Admin : un Trust explique des zones
// d'incertitude internes (preuves faibles, contradictions, complétude) qui
// n'ont de sens que pour un usage interne de staffing, jamais pour le
// Client ni l'Ingénieur.
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

  const candidateIntelligence = construireCandidateIntelligence(entree);
  const talentIntelligence = construireTalentIntelligence(candidateIntelligence);
  const talentTrust = construireTalentTrust(candidateIntelligence, talentIntelligence);

  return NextResponse.json({ profilId: profil.id, nom: profil.nom, prenom: profil.prenom, talentTrust });
}
