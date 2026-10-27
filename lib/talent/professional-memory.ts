// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 2.
//
// "La mémoire professionnelle est d'abord un MODÈLE DE DONNÉES + RELATIONS +
// PREUVES. L'UI vient ensuite." (mandat CEO). Ce module ne stocke rien et ne
// recalcule aucun statut de provenance — il assemble simplement, pour
// affichage, les données déjà réelles : une ProfilCompetence, ses
// SkillEvidence (voir lib/talent/skill-graph.ts, inchangé), et les Mission
// qui lui ont été explicitement reliées via MissionCompetence
// (prisma/schema.prisma) par POST /api/missions/[id]/competences.
//
// Fonction pure, DB-free, comme le reste de lib/talent/* — l'appelant (route
// API) fournit des données déjà chargées en une seule requête groupée.
//
// Répond exactement aux 5 questions du mandat CEO :
//   "Quelles compétences cet Engineer a-t-il effectivement utilisées dans
//   des missions ?" -> MemoirePro.competences[].missions
//   "Quelles preuves soutiennent cette affirmation ?" -> .preuves (déjà
//   exposées par lib/talent/skill-graph.ts, non recalculées ici)
//   "Quel est le résultat associé ?" -> .missions[].evaluation
//   "Quelle est la fraîcheur de cette preuve ?" -> déjà répondu par
//   lib/talent/evidence-confidence.ts (confianceDetaillee), non dupliqué ici
//   "Cette information est-elle déclarée, inférée ou vérifiée ?" -> .statut
//   (StatutPreuveCompetence, inchangé)

export type MissionPourMemoire = {
  id: string;
  repere: string | null;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
  evaluation: { note: number; commentaire: string | null } | null;
};

export type LienMissionCompetence = {
  missionId: string;
  profilCompetenceId: string;
  creeParEmail: string;
  createdAt: string;
};

export type EntreeMemoireCompetence = {
  profilCompetenceId: string;
  competence: string;
  missions: MissionPourMemoire[];
};

// Regroupe les liens MissionCompetence par compétence, en résolvant chaque
// missionId vers la Mission complète (déjà chargée par l'appelant) — jamais
// de Mission "fantôme" : un lien dont la Mission n'est plus dans la liste
// fournie est silencieusement ignoré (n'arrive normalement jamais, la FK
// onDelete: Cascade supprime le lien avec la Mission).
export function construireMemoireProfessionnelle(
  liens: LienMissionCompetence[],
  missionsParId: Map<string, MissionPourMemoire>,
  competencesParId: Map<string, string>
): EntreeMemoireCompetence[] {
  const parCompetence = new Map<string, EntreeMemoireCompetence>();

  for (const lien of liens) {
    const mission = missionsParId.get(lien.missionId);
    const competence = competencesParId.get(lien.profilCompetenceId);
    if (!mission || !competence) continue;

    const existante = parCompetence.get(lien.profilCompetenceId);
    if (existante) {
      existante.missions.push(mission);
    } else {
      parCompetence.set(lien.profilCompetenceId, {
        profilCompetenceId: lien.profilCompetenceId,
        competence,
        missions: [mission],
      });
    }
  }

  // Ordre stable et déterministe pour l'UI : par nom de compétence.
  return Array.from(parCompetence.values()).sort((a, b) => a.competence.localeCompare(b.competence));
}

// Nombre de missions ayant réellement produit une preuve pour au moins une
// compétence — purement informatif (jamais un score), utilisé pour une seule
// phrase de synthèse côté UI ("Professional Memory: N missions reliées à M
// compétences").
export function compterMissionsAvecPreuveCompetence(liens: LienMissionCompetence[]): number {
  return new Set(liens.map((l) => l.missionId)).size;
}
