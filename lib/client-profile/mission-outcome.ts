// COMPANY ATLAS — LOT 7 : Mission Outcome → Client Profile Bridge (16/09/2026).
//
// Fonction PURE (aucun accès Prisma) : détecte un signal déterministe de
// qualité d'exécution à partir des Evaluation réelles du client — jamais un
// fait confirmé automatiquement (même discipline que detecterRecurrences,
// LOT 4 : "SIGNAL != FAIT CONFIRMÉ"). Seule une action explicite du client
// ("Enregistrer dans mon profil") transforme ce signal en ClientProfileFact
// (CRITERE_REUSSITE_DURABLE, statut DECLARE, source
// "client_confirmation_signal") — via app/api/client/profil/faits/route.ts,
// route INCHANGÉE : le chemin AJOUTER+depuisSignal existe déjà depuis LOT 4.
//
// Aucune donnée inventée : `valeur` n'assemble que des nombres réellement
// calculés à partir d'Evaluation.note (jamais une catégorie ou un jugement
// non dérivable des données). Seuils identiques en esprit à
// lib/client-profile/recurrence.ts (SEUIL_OCCURRENCES=2).

export type MissionEvaluee = { id: string; note: number };

export type SignalResultatMission = {
  cle: "CRITERE_REUSSITE_DURABLE";
  valeur: string;
  noteMoyenne: number;
  occurrences: number;
  missionIds: string[];
};

const SEUIL_OCCURRENCES = 2;
const SEUIL_NOTE_MOYENNE = 4;

export function detecterSignalResultatMission(missions: MissionEvaluee[]): SignalResultatMission | null {
  if (missions.length < SEUIL_OCCURRENCES) return null;

  const noteMoyenne = missions.reduce((somme, m) => somme + m.note, 0) / missions.length;
  if (noteMoyenne < SEUIL_NOTE_MOYENNE) return null;

  return {
    cle: "CRITERE_REUSSITE_DURABLE",
    valeur: `Qualité d'exécution confirmée sur ${missions.length} missions évaluées (note moyenne ${noteMoyenne.toFixed(1)}/5).`,
    noteMoyenne,
    occurrences: missions.length,
    missionIds: missions.map((m) => m.id),
  };
}
