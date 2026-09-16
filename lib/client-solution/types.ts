// COMPANY ATLAS — V2.1-B : C3 Solution Intelligence, types partagés.
//
// Fonctions pures uniquement (voir adapter.ts, comparaison.ts, normalisation.ts) —
// aucun de ces types ne doit jamais porter profilId, nom, prénom, email,
// téléphone, TJM, coût, marge, score numérique brut, contradictions ou
// facteurs défavorables internes (voir adapter.ts, frontière de sécurité).

export type NiveauConfianceOption = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

export type StatutDisponibiliteOption = "CONNUE" | "UNKNOWN";

// Sortie de adapterEnOptionClient() — strictement Client-safe, construite par
// allowlist. Aucun champ ne doit permettre de retrouver ou de ré-identifier
// indirectement un Engineer (voir revue architecturale V2.1, section 6).
export type OptionClientSafe = {
  typeSolution: "TALENT";
  competencesCorrespondantes: string[];
  niveauConfiance: NiveauConfianceOption;
  rationale: string[];
  criteresAPreciser: string[];
  disponibilite: { statut: StatutDisponibiliteOption; detail: string | null };
};

export type OptionOrdonnee = OptionClientSafe & { rang: number };

export type RecommandationSolution = {
  // Pointe vers OptionOrdonnee.rang, jamais un identifiant de profil ou de
  // demande — la correspondance rang -> Engineer réel reste entièrement
  // hors de cette couche pure (résolue par l'appelant, hors V2.1-B).
  rangRecommande: number;
  justification: string;
  criteresDeterminants: string[];
  inconnuesImportantes: string[];
  // Rangs des options jugées équivalentes à l'option recommandée — jamais
  // un gagnant inventé entre deux options strictement à égalité.
  rangsAlternativesEquivalentes: number[];
  niveauConfiance: NiveauConfianceOption;
};

export type ResultatComparaison = {
  optionsOrdonnees: OptionOrdonnee[];
  // null si aucune recommandation fiable ne peut être produite (0 option,
  // ou données trop insuffisantes même avec 1 option) — jamais une
  // recommandation forcée. Voir raisonAbsenceRecommandation pour le motif.
  recommandation: RecommandationSolution | null;
  raisonAbsenceRecommandation: "AUCUNE_OPTION" | "DONNEES_INSUFFISANTES" | null;
};
