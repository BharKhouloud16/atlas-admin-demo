// ADMISSIBILITÉ D'UN PROFIL POUR UN BESOIN — couche au-dessus du Matching
// Engine (lib/talent/matching.ts), qui reste inchangé dans son scoring.
//
// Le score de matching sert à CLASSER ; il ne dit pas si un profil peut être
// PRÉSENTÉ. Ce module sépare les deux :
//   - critères obligatoires et bloquants : compétences demandées (toutes
//     obligatoires en V1 : le besoin ne distingue pas encore « obligatoire » /
//     « souhaitée »), budget maximum dépassé, disponibilité immédiate exigée
//     mais impossible, localisation incompatible (criteresBloquants du moteur) ;
//   - critères souhaités et négociables : séniorité, expérience, secteur,
//     mobilité — signalés comme écarts, jamais bloquants ;
//   - compétences vérifiées (Admin), déclarées (Ingénieur) et extraites du CV
//     non vérifiées (INFERE) : seules les deux premières couvrent un besoin ;
//   - compatibilité confirmée et donnée inconnue : une contrainte exprimée par
//     le Client dont la valeur côté profil est inconnue n'est JAMAIS comptée
//     comme compatible ; elle est « à confirmer ».
// Module pur : aucune dépendance à Prisma, aucun appel réseau, déterministe.

import type { CriteresDemande, ProfilPourMatching, ResultatMatching } from "./matching";

export type NiveauCorrespondance = "FORTE" | "PARTIELLE" | "NON_ADMISSIBLE";

export type ContrainteAConfirmer = "BUDGET" | "DISPONIBILITE" | "LOCALISATION";

const ACTION_A_CONFIRMER: Record<ContrainteAConfirmer, string> = {
  BUDGET: "TJM du profil non renseigné — l'établir avant toute présentation (budget client exprimé)",
  DISPONIBILITE: "Disponibilité du profil non renseignée — la confirmer avec l'ingénieur avant toute présentation",
  LOCALISATION: "Localisation du profil non renseignée — la confirmer avec l'ingénieur avant toute présentation",
};

const LIBELLE_CLIENT_A_CONFIRMER: Record<ContrainteAConfirmer, string> = {
  BUDGET: "Respect de votre budget à confirmer.",
  DISPONIBILITE: "Disponibilité à confirmer.",
  LOCALISATION: "Localisation à confirmer.",
};

// Vue Admin : distingue ce qui peut être présenté tout de suite de ce qui
// demande une action avant présentation, et de ce qui n'est pas pertinent.
export type CategorieAdmin = "PRESENTABLE" | "OPPORTUNITE" | "NON_PERTINENT";

export type Admissibilite = {
  niveau: NiveauCorrespondance;
  presentableClient: boolean;
  categorieAdmin: CategorieAdmin;
  competencesDemandees: string[];
  competencesVerifiees: string[]; // demandées et VERIFIE (Admin)
  competencesDeclarees: string[]; // demandées et DECLARE (Ingénieur), non encore vérifiées
  competencesNonVerifiees: string[]; // demandées, présentes seulement comme extraites (INFERE/INCONNU)
  competencesManquantes: string[]; // demandées et non couvertes (inclut les non vérifiées)
  contraintesBloquantes: string[]; // incompatibilités réelles (budget, disponibilité, localisation)
  contraintesAConfirmer: ContrainteAConfirmer[]; // contraintes exprimées par le Client, inconnues côté profil
  ecartsNegociables: string[]; // critères souhaités non satisfaits ou non renseignés
  motifsNonAdmissible: string[];
  actionsAdmin: string[]; // pistes d'action, jamais une compétence ou une disponibilité inventée
};

// Les compétences du profil et leur statut de preuve. Même règle que le
// moteur (competencesPourScoring) : Skill Graph s'il existe, sinon repli sur
// Profil.competences, déclarées par l'Ingénieur.
function statutsCompetences(profil: ProfilPourMatching): Map<string, string> {
  if (profil.competencesGraph && profil.competencesGraph.length > 0) {
    return new Map(profil.competencesGraph.map((c) => [c.competence, c.statut]));
  }
  return new Map(profil.competences.map((c) => [c, "DECLARE"]));
}

export function evaluerAdmissibilite(profil: ProfilPourMatching, criteres: CriteresDemande, resultat: ResultatMatching): Admissibilite {
  const demandees = Array.from(new Set(criteres.competencesRecherchees));
  const statuts = statutsCompetences(profil);
  const verifiees = demandees.filter((c) => statuts.get(c) === "VERIFIE");
  const declarees = demandees.filter((c) => statuts.get(c) === "DECLARE");
  const couvertes = new Set([...verifiees, ...declarees]);
  const nonVerifiees = demandees.filter((c) => statuts.get(c) === "INFERE" || statuts.get(c) === "INCONNU");
  const manquantes = demandees.filter((c) => !couvertes.has(c));
  const bloquantes = [...resultat.criteresBloquants];
  const f = resultat.facteurs;

  // Contraintes obligatoires exprimées par le Client mais inconnues côté profil.
  const aConfirmer: ContrainteAConfirmer[] = [];
  if (criteres.budgetTjmMax != null && f.budget.statut === "INSUFFISANT") aConfirmer.push("BUDGET");
  if (criteres.disponibiliteSouhaitee && f.disponibilite.statut === "INSUFFISANT") aConfirmer.push("DISPONIBILITE");
  if (criteres.localisation && f.localisation.statut === "INSUFFISANT") aConfirmer.push("LOCALISATION");

  // Critères souhaités : écarts négociables, jamais bloquants.
  const ecarts: string[] = [];
  for (const facteur of [f.seniorite, f.experience]) {
    const exprime = facteur.valeurDemandee !== "non précisée";
    if (exprime && facteur.statut !== "MATCH") ecarts.push(`${facteur.label} : ${facteur.detail}`);
  }
  if (f.disponibilite.statut === "PARTIEL" && criteres.disponibiliteSouhaitee) ecarts.push(`Disponibilité : ${f.disponibilite.detail}`);

  const motifs: string[] = [];
  if (demandees.length === 0) motifs.push("Aucune compétence précisée dans le besoin : correspondance impossible à établir");
  else if (couvertes.size === 0) motifs.push("Aucune des compétences demandées n'est vérifiée ou déclarée sur ce profil");
  for (const b of bloquantes) motifs.push(`Contrainte bloquante : ${b}`);

  let niveau: NiveauCorrespondance;
  if (motifs.length > 0) niveau = "NON_ADMISSIBLE";
  else if (manquantes.length === 0 && aConfirmer.length === 0) niveau = "FORTE";
  else niveau = "PARTIELLE";

  const actions: string[] = [];
  if (nonVerifiees.length > 0) actions.push(`Faire vérifier les compétences extraites du CV : ${nonVerifiees.join(", ")}`);
  if (declarees.length > 0) actions.push(`Vérifier les compétences déclarées par l'ingénieur : ${declarees.join(", ")}`);
  const absentes = manquantes.filter((c) => !nonVerifiees.includes(c));
  if (absentes.length > 0 && couvertes.size > 0) actions.push(`Compétences absentes du profil : ${absentes.join(", ")} — échanger avec le client sur leur caractère indispensable`);
  if (f.budget.statut === "INCOMPATIBLE") actions.push(`Budget dépassé (${f.budget.detail}) — rediscuter le budget avec le client`);
  if (f.disponibilite.statut === "INCOMPATIBLE") actions.push("Disponibilité incompatible — proposer au client une date de démarrage différée");
  if (f.localisation.statut === "INCOMPATIBLE") actions.push("Localisation incompatible — étudier le travail à distance avec le client");
  for (const c of aConfirmer) actions.push(ACTION_A_CONFIRMER[c]);

  const categorieAdmin: CategorieAdmin =
    niveau !== "NON_ADMISSIBLE" ? "PRESENTABLE" : couvertes.size > 0 || nonVerifiees.length > 0 ? "OPPORTUNITE" : "NON_PERTINENT";

  return {
    niveau,
    presentableClient: niveau !== "NON_ADMISSIBLE",
    categorieAdmin,
    competencesDemandees: demandees,
    competencesVerifiees: verifiees,
    competencesDeclarees: declarees,
    competencesNonVerifiees: nonVerifiees,
    competencesManquantes: manquantes,
    contraintesBloquantes: bloquantes,
    contraintesAConfirmer: aConfirmer,
    ecartsNegociables: ecarts,
    motifsNonAdmissible: motifs,
    actionsAdmin: niveau === "NON_ADMISSIBLE" && categorieAdmin === "NON_PERTINENT" ? [] : actions,
  };
}

// Ordre de présentation au Client : correspondances fortes d'abord, puis par
// nombre de compétences couvertes, puis par score de classement.
export function comparerAdmissibles(
  a: { admissibilite: Admissibilite; resultat: ResultatMatching },
  b: { admissibilite: Admissibilite; resultat: ResultatMatching }
): number {
  const rang = (x: Admissibilite) => (x.niveau === "FORTE" ? 0 : x.niveau === "PARTIELLE" ? 1 : 2);
  const couverture = (x: Admissibilite) => x.competencesVerifiees.length + x.competencesDeclarees.length;
  return (
    rang(a.admissibilite) - rang(b.admissibilite) ||
    couverture(b.admissibilite) - couverture(a.admissibilite) ||
    b.resultat.score - a.resultat.score ||
    a.resultat.profilId.localeCompare(b.resultat.profilId)
  );
}

// Texte présenté au Client : aucune identité, aucun TJM, aucun score interne.
export function libelleClient(a: Admissibilite): { titre: string; lignes: string[] } {
  const couvertes = [...a.competencesVerifiees, ...a.competencesDeclarees];
  const lignes: string[] = [];
  if (a.niveau === "FORTE") {
    lignes.push(`Correspondance forte : les ${a.competencesDemandees.length} compétence(s) demandée(s) sont couvertes.`);
  } else {
    lignes.push(`Correspondance partielle : ${couvertes.length}/${a.competencesDemandees.length} compétence(s) demandée(s) couverte(s).`);
  }
  if (a.competencesVerifiees.length > 0) lignes.push(`Vérifiées par ATLAS : ${a.competencesVerifiees.join(", ")}.`);
  if (a.competencesDeclarees.length > 0) lignes.push(`Déclarées par l'ingénieur : ${a.competencesDeclarees.join(", ")}.`);
  if (a.competencesManquantes.length > 0) lignes.push(`Non couvertes à ce jour : ${a.competencesManquantes.join(", ")}.`);
  for (const c of a.contraintesAConfirmer) lignes.push(LIBELLE_CLIENT_A_CONFIRMER[c]);
  const titre = a.niveau === "FORTE" ? `Correspondance forte — ${couvertes.join(", ")}` : `Correspondance partielle — ${couvertes.join(", ")}`;
  return { titre, lignes };
}
