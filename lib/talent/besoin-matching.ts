// ATLAS LOT 15.5 — Client Requirement Builder : relie un RequirementStructure
// validé par le Client au Matching Engine V2 existant (lib/talent/matching.ts,
// jamais modifié, jamais dupliqué) et applique les règles propres au
// self-service : critères REQUIRED traités comme des contraintes bloquantes
// (jamais un simple malus de score), maximum 5 résultats, jamais complété
// artificiellement.
import { classerProfils, type ProfilPourMatching, type ResultatMatching } from "./matching";
import type { RequirementStructure } from "./requirement-analyzer";

export const MAX_RESULTATS_BESOIN = 5;

// Une information absente ne devient JAMAIS une correspondance positive
// (règle explicite du mandat) : chaque contrainte REQUIRED ci-dessous exige
// une donnée réelle et vérifiable sur le profil, jamais une valeur par
// défaut favorable en cas d'inconnu.
//
// Le filtre "skills REQUIRED" compare directement à `profil.competences`
// (la liste déclarée), pas au Skill Graph résolu par le Matching Engine —
// simplification volontaire et documentée (voir rapport du Lot 15.5) : le
// classement par score, lui, reste calculé par classerProfils() avec le
// Skill Graph quand il existe (comportement V2 inchangé), seul ce filtre
// d'éligibilité dur utilise la liste déclarée.
function satisfaitCriteresRequis(profil: ProfilPourMatching, requirement: RequirementStructure): boolean {
  // ATLAS ne collecte aujourd'hui aucune donnée de certification côté
  // ingénieur : une certification REQUIRED ne peut donc jamais être
  // honnêtement satisfaite tant que cette donnée n'existe pas.
  const certificationsRequises = requirement.certifications.filter((c) => c.priorite === "REQUIRED");
  if (certificationsRequises.length > 0) return false;

  const skillsRequis = requirement.skills.filter((s) => s.priorite === "REQUIRED").map((s) => s.valeur);
  if (skillsRequis.length > 0 && !skillsRequis.every((s) => profil.competences.includes(s))) return false;

  if (requirement.experienceMinAnnees != null) {
    if (profil.anneesExperience == null || profil.anneesExperience < requirement.experienceMinAnnees) return false;
  }

  return true;
}

export type CandidatBesoin = { profil: ProfilPourMatching; resultat: ResultatMatching };

// Ne filtre ni ne complète artificiellement : si moins de 5 (ou aucun)
// candidat satisfait les contraintes REQUIRED, c'est exactement ce qui est
// retourné (voir l'appelant, Partie G du mandat, pour le message explicite
// en cas de liste vide).
export function classerAvecRequirement(profils: ProfilPourMatching[], requirement: RequirementStructure): CandidatBesoin[] {
  const skillsPourScoring = requirement.skills.filter((s) => s.priorite !== "OPTIONAL").map((s) => s.valeur);

  const classement = classerProfils(profils, {
    competencesRecherchees: skillsPourScoring,
    senioriteSouhaitee: null,
    budgetTjmMax: null,
    anneesExperienceMin: requirement.experienceMinAnnees,
    secteurActivite: requirement.domaine,
    localisation: requirement.localisation,
    mobilite: null,
    disponibiliteSouhaitee: requirement.disponibilite,
  });

  const profilsParId = new Map(profils.map((p) => [p.id, p]));

  return classement
    .filter((resultat) => satisfaitCriteresRequis(profilsParId.get(resultat.profilId)!, requirement))
    .slice(0, MAX_RESULTATS_BESOIN)
    .map((resultat) => ({ profil: profilsParId.get(resultat.profilId)!, resultat }));
}
