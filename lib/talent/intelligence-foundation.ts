// ATLAS INTELLIGENCE FOUNDATION V1 (Batch 11, 07/09/2026). Une seule vue
// "Profil 360" pour l'Admin, assemblant les quatre modules Talent déjà
// existants et déjà testés — Candidate Intelligence (Batch 4), Talent
// Intelligence (Batch 5), Talent Trust (Batch 8), Mission Intelligence
// (Batch 9) — SANS RÉIMPLÉMENTER AUCUNE LOGIQUE DE SCORE : ce module ne
// fait qu'appeler, dans l'ordre, les fonctions pures déjà en place et
// regrouper leurs résultats.
//
// RÈGLE ABSOLUE, LA PLUS IMPORTANTE DE CE MODULE : il n'y a PAS de score ou
// de niveau "global" unique fusionnant les quatre blocs. Chaque bloc garde
// SON PROPRE niveau de confiance/trust (voir CandidateIntelligence,
// TalentIntelligence, TalentTrust.niveauGlobal, MissionIntelligence) — les
// fusionner en un seul chiffre serait exactement le "score magique" que
// l'ordre d'exécution ATLAS interdit (les niveaux ne sont pas sur la même
// échelle ni construits de la même façon : additionner ou moyenner des
// "HAUTE/MOYENNE/BASSE" et des ratios statistiques n'aurait aucun sens
// mathématique et donnerait une fausse impression de précision). Un
// consommateur de cette fondation doit lire les quatre blocs et les
// interpréter chacun dans son contexte, jamais un résumé automatique.
//
// Architecture ATLAS respectée : DATA -> EVIDENCE -> CONFIDENCE -> TRUST ->
// INTELLIGENCE -> RECOMMENDATION -> HUMAN DECISION -> AUDIT. Ce module se
// situe au niveau INTELLIGENCE (assemblage), jamais RECOMMENDATION : il ne
// contient aucune recommandation ni décision — voir
// lib/talent/recommendation-engine.ts (Batch 6) pour ça, qui reste un
// module séparé, volontairement non inclus ici (une recommandation est
// contextuelle à une DemandeTalent précise, pas à un profil isolé).
//
// Bénéfice concret de cette fondation (au-delà de la commodité) : les trois
// routes existantes (.../intelligence, .../talent-intelligence,
// .../talent-trust) exécutent chacune la MÊME requête Prisma groupée en
// double/triple ; cette fondation et sa route API sœur ne l'exécutent
// qu'UNE SEULE FOIS pour les quatre blocs. Les routes existantes ne sont ni
// supprimées ni modifiées (elles peuvent rester utilisées isolément) — ce
// module est strictement additif.

import { construireCandidateIntelligence, type ProfilPourIntelligence, type CandidateIntelligence } from "./candidate-intelligence";
import { construireTalentIntelligence, type TalentIntelligence } from "./talent-intelligence";
import { construireTalentTrust, type TalentTrust } from "./talent-trust";
import {
  construireMissionIntelligence,
  type MissionPourAnalytics,
  type EvaluationPourAnalytics,
  type MissionIntelligence,
} from "./mission-intelligence";

export type IntelligenceFoundation = {
  profilId: string;
  candidateIntelligence: CandidateIntelligence;
  talentIntelligence: TalentIntelligence;
  talentTrust: TalentTrust;
  missionIntelligence: MissionIntelligence;
  avertissement: string;
};

// Fonction pure centrale — aucun calcul propre, uniquement de la
// composition. profil suit exactement ProfilPourIntelligence (même type
// d'entrée que Candidate/Talent/Trust) ; missions/evaluations suivent
// exactement les types d'entrée de Mission Intelligence (Batch 9). C'est à
// l'appelant (route API) de charger les données une seule fois et de les
// adapter vers ces deux formes déjà établies — jamais une nouvelle requête
// ici.
export function construireIntelligenceFoundation(
  profil: ProfilPourIntelligence,
  missions: MissionPourAnalytics[],
  evaluations: EvaluationPourAnalytics[]
): IntelligenceFoundation {
  const candidateIntelligence = construireCandidateIntelligence(profil);
  const talentIntelligence = construireTalentIntelligence(candidateIntelligence);
  const talentTrust = construireTalentTrust(candidateIntelligence, talentIntelligence);
  const missionIntelligence = construireMissionIntelligence(profil.id, missions, evaluations);

  return {
    profilId: profil.id,
    candidateIntelligence,
    talentIntelligence,
    talentTrust,
    missionIntelligence,
    avertissement:
      "Atlas Intelligence Foundation V1 — assemble Candidate Intelligence, Talent Intelligence, Talent Trust et Mission Intelligence, chacun conservant son propre niveau de confiance/trust. Aucun score global fusionné, aucune recommandation, aucune décision automatique : destiné exclusivement à une revue humaine (staffing interne).",
  };
}
