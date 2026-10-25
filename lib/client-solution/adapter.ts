import type { Recommandation } from "@/lib/talent/recommendation-engine";
import type { OptionClientSafe } from "./types";
import { interpreterDisponibilite } from "./normalisation";
import { libelleClient, type Admissibilite } from "@/lib/talent/admissibilite";

// COMPANY ATLAS — V2.1-B : C3 Solution Intelligence — FRONTIÈRE DE SÉCURITÉ.
//
// adapterEnOptionClient() est le SEUL point de passage autorisé entre les
// données internes ATLAS TALENT (Recommandation, lib/talent/recommendation-
// engine.ts — jamais modifié) et toute donnée Client-safe de C3. Aucune
// autre fonction de ce domaine ne doit lire une Recommandation ou un Profil
// directement.
//
// Construction stricte par ALLOWLIST : la sortie est un littéral d'objet
// dont chaque champ est explicitement choisi — jamais un spread de l'entrée,
// jamais une copie partielle qui pourrait laisser passer un champ futur
// ajouté à Recommandation sans revue de cette fonction.
//
// Volontairement EXCLUS de la sortie (jamais lus, jamais transmis) :
// - recommandation.profilId (identité)
// - recommandation.preuves (citations d'évidence pouvant indirectement
//   décrire un candidat précis — hors allowlist, voir revue architecturale
//   V2.1 section 6)
// - recommandation.scoreMatching (score numérique opaque)
// - recommandation.contradictions / facteursDefavorables (raisonnement
//   interne de staffing, jamais destiné au Client)
// - recommandation.statutMatching (vocabulaire interne du Matching V2)
// - toute donnée de coût/TJM/marge (jamais présente dans Recommandation,
//   mais jamais lue même si elle devait un jour y apparaître : cette
//   fonction n'accède à aucune autre structure que les champs listés
//   explicitement ci-dessous)
//
// Admissibilité (lib/talent/admissibilite.ts) : seuls le niveau de
// correspondance, les listes de compétences demandées (vérifiées, déclarées,
// manquantes) et le libellé Client sont lus. Jamais ecartsNegociables ni
// actionsAdmin (valeurs du profil et raisonnement interne de staffing).
//
// Pure : aucune DB, aucun HTTP, ne mute jamais son entrée.
export function adapterEnOptionClient(
  recommandation: Recommandation,
  disponibiliteBrute: string | null = null,
  admissibilite: Admissibilite | null = null
): OptionClientSafe {
  if (admissibilite && admissibilite.niveau !== "NON_ADMISSIBLE") {
    return {
      typeSolution: "TALENT",
      niveauCorrespondance: admissibilite.niveau,
      competencesCorrespondantes: [...admissibilite.competencesVerifiees, ...admissibilite.competencesDeclarees],
      competencesManquantes: [...admissibilite.competencesManquantes],
      niveauConfiance: recommandation.niveauConfiance,
      rationale: libelleClient(admissibilite).lignes,
      criteresAPreciser: [...recommandation.criteresManquants],
      disponibilite: interpreterDisponibilite(disponibiliteBrute),
    };
  }
  return {
    typeSolution: "TALENT",
    competencesCorrespondantes: [...recommandation.competencesCorrespondantes],
    niveauConfiance: recommandation.niveauConfiance,
    rationale: [...recommandation.rationale],
    criteresAPreciser: [...recommandation.criteresManquants],
    disponibilite: interpreterDisponibilite(disponibiliteBrute),
  };
}
