// ENGINEER PROFILE V2 — Lot 6 : Trust Client (MVP).
//
// Fonction pure de PROJECTION uniquement — voir le contrat produit validé
// (rapport "FINAL PRODUCT CONTRACT") : DATABASE -> AUTHORIZATION ->
// PROJECTION -> UI, chaque étape strictement séparée. Ce module ne contient
// AUCUNE logique d'autorisation (jamais de session, jamais de Prisma) et ne
// lit rien en base — il transforme des données déjà chargées et déjà
// filtrées par l'appelant (route API) en un vocabulaire Client sûr.
//
// RÈGLE ABSOLUE : seuls les statuts DECLARE et VERIFIE produisent un signal.
// INFERE et INCONNU ne sont JAMAIS traduits — buildClientTrustSignal
// renvoie null pour toute autre valeur, sans exception, sans "presque"
// (contrat : "aucune inférence exposée").
//
// VERIFIE et DECLARE sont deux variantes du MÊME signal de provenance,
// jamais cumulées : une compétence VERIFIE n'affiche jamais aussi le texte
// DECLARE.

export type StatutProvenanceEligible = "DECLARE" | "VERIFIE";

export type LibelleProvenance = {
  statut: StatutProvenanceEligible;
  label: string;
  shortLabel: string;
  explanation: string;
};

// Textes figés par le contrat produit — ne jamais paraphraser, ne jamais
// ajouter "vérifié"/"certifié"/"garanti" nulle part dans ce module.
const LIBELLES_PROVENANCE: Record<StatutProvenanceEligible, LibelleProvenance> = {
  DECLARE: {
    statut: "DECLARE",
    label: "Compétence déclarée par l'ingénieur.",
    shortLabel: "Déclarée",
    explanation: "Cette information a été renseignée par l'ingénieur lui-même.",
  },
  VERIFIE: {
    statut: "VERIFIE",
    label: "Information confirmée en interne par un administrateur Atlas.",
    shortLabel: "Confirmée par Atlas",
    explanation: "Un membre de l'équipe Atlas a examiné cette information.",
  },
};

export const SIGNAL_MOBILISATION = {
  label: "Compétence mobilisée dans une mission réalisée pour un client Atlas.",
  shortLabel: "Mission réalisée",
  explanation: "Cette compétence a été utilisée dans le cadre d'une mission terminée.",
};

export type CompetencePourTrustClient = {
  competence: string;
  // Accepte n'importe quelle chaîne (le statut Prisma réel) — le filtrage
  // sur DECLARE/VERIFIE se fait ici, jamais supposé déjà fait par l'appelant.
  statut: string;
  mobiliseeEnMission: boolean;
};

export type SignalTrustClient = {
  competence: string;
  provenance: LibelleProvenance;
  mobilisation: typeof SIGNAL_MOBILISATION | null;
};

// Une seule compétence -> un signal, ou null si non éligible (INFERE/
// INCONNU/toute autre valeur). `mobiliseeEnMission` alimente un second
// texte figé, jamais un troisième "type" de signal (le contrat plafonne à
// 2 signaux par compétence : provenance + mobilisation).
export function buildClientTrustSignal(competence: CompetencePourTrustClient): SignalTrustClient | null {
  if (competence.statut !== "DECLARE" && competence.statut !== "VERIFIE") return null;
  return {
    competence: competence.competence,
    provenance: LIBELLES_PROVENANCE[competence.statut],
    mobilisation: competence.mobiliseeEnMission ? SIGNAL_MOBILISATION : null,
  };
}

// Ordre déterministe, jamais un classement caché (jamais le score de
// matching ni Talent Trust) : alphabétique, puis plafonné à un nombre fixe
// et documenté — 5, cohérent avec le contrat produit ("2 à 4 signaux
// maximum" par compétence, et un nombre de compétences volontairement
// restreint pour rester "extrêmement simple").
const PLAFOND_COMPETENCES = 5;

export function construireSignauxTrustClient(competences: CompetencePourTrustClient[]): SignalTrustClient[] {
  return competences
    .map(buildClientTrustSignal)
    .filter((s): s is SignalTrustClient => s !== null)
    .sort((a, b) => a.competence.localeCompare(b.competence))
    .slice(0, PLAFOND_COMPETENCES);
}
