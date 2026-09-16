import type { NiveauCertitudeSolution } from "@prisma/client";
import type { NiveauConfianceOption, StatutDisponibiliteOption } from "./types";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — types de la couche de
// persistance/API (impurs : reflètent SolutionOption, jamais utilisés par
// les fonctions pures de adapter.ts/comparaison.ts/normalisation.ts).
//
// Structure stockée dans SolutionOption.donnees (Json) — jamais une
// deuxième colonne dédiée, cohérent avec le socle V2.1-A qui ne doit pas
// être modifié sans nécessité réelle (aucune ici : Json suffit).
export type DonneesSolutionOption = {
  signatureSource: string;
  competencesCorrespondantes: string[];
  niveauConfiance: NiveauConfianceOption;
  rationale: string[];
  criteresAPreciser: string[];
  disponibilite: { statut: StatutDisponibiliteOption; detail: string | null };
  // Renseignés uniquement sur une ligne niveau=RECOMMANDATION.
  criteresDeterminants?: string[];
  inconnuesImportantes?: string[];
  rangsAlternativesEquivalentes?: number[];
};

// Vue exposée à l'API (Client ou Admin) — reprend uniquement des champs déjà
// Client-safe (SolutionOption ne persiste jamais rien d'autre, voir
// generation.ts) + l'id technique de la ligne (opaque, jamais dérivé d'une
// donnée Talent) nécessaire pour référencer une RECOMMANDATION lors d'une
// décision.
export type SolutionOptionVue = {
  id: string;
  niveau: NiveauCertitudeSolution;
  typeSolution: "TALENT";
  titre: string;
  justification: string;
  competencesCorrespondantes: string[];
  niveauConfiance: NiveauConfianceOption;
  criteresAPreciser: string[];
  disponibilite: { statut: StatutDisponibiliteOption; detail: string | null };
  sourceOptionId: string | null;
  decideParEmail: string | null;
  decideLe: string | null;
  createdAt: string;
};
