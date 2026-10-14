// COMPANY ATLAS — A8 : Capability Engine V1 (05/10/2026).
//
// Fonction PURE (aucun accès Prisma) : transforme les faits COMPETENCE
// ACTIFS d'une version de Need en CapabilityRequirement candidats.
//
// Discipline "ne jamais inventer" (mandat A8 §8/§13/§15) :
// - V1 est déterministe, sans IA, sans scoring, sans modèle probabiliste.
// - Source UNIQUE génératrice : ClientNeedFait(cle=COMPETENCE, statutActivite
//   =ACTIVE). CRITERE_REUSSITE n'est délibérément PAS une source génératrice
//   directe — produire une "capacité" à partir d'une phrase de critère de
//   succès exigerait une synthèse non triviale, interdite ici. La
//   distinction Skill != Capability enrichie (mandat §7) reste pour un
//   futur lot IA-assisté passant par ce même pipeline de provenance,
//   jamais fabriquée en V1 : `requiredCapability` est le texte brut du
//   fait COMPETENCE, jamais une reformulation.
// - Aucune absence de COMPETENCE n'est jamais transformée en succès ou en
//   capacité devinée : `NO_CAPABILITY_DERIVABLE` est un état explicite,
//   distinct d'une liste vide "normale" (voir ResultatDerivation).

export type FaitPourCapacite = {
  id: string;
  cle: string;
  valeur: string;
  statut: string; // StatutPreuveCompetence, recopié tel quel
  statutActivite?: string; // NeedFactStatus — ACTIVE si absent (domaines sans ce champ)
};

export type CapaciteCandidate = {
  sourceFaitId: string;
  requiredCapability: string;
  rationale: string;
  provenance: string; // StatutPreuveCompetence du fait source, recopié tel quel
};

export type ResultatDerivation =
  | { statut: "NO_CAPABILITY_DERIVABLE"; capacites: [] }
  | { statut: "DERIVEES"; capacites: CapaciteCandidate[] };

// Déterministe : deux appels avec les mêmes `faits` produisent exactement
// le même résultat, dans le même ordre (tri par id du fait source — jamais
// par valeur, pour ne jamais dépendre d'un ordre non stable).
export function deriverCapacites(faits: FaitPourCapacite[]): ResultatDerivation {
  const competencesActives = faits
    .filter((f) => f.cle === "COMPETENCE")
    .filter((f) => f.statutActivite === undefined || f.statutActivite === "ACTIVE")
    .filter((f) => f.valeur && f.valeur.trim().length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (competencesActives.length === 0) {
    return { statut: "NO_CAPABILITY_DERIVABLE", capacites: [] };
  }

  const capacites: CapaciteCandidate[] = competencesActives.map((fait) => ({
    sourceFaitId: fait.id,
    requiredCapability: fait.valeur,
    rationale: `Compétence déclarée requise par le besoin (fait ${fait.id}, clé COMPETENCE).`,
    provenance: fait.statut,
  }));

  return { statut: "DERIVEES", capacites };
}
