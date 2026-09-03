// Extraction des informations d'un CV.
//
// Aujourd'hui : pas d'IA branchée. On génère une liste de champs "modèle",
// laissés vides, que l'ingénieur remplit et valide lui-même un par un dans
// /ingenieur/cv/verifier (saisie manuelle guidée).
//
// Demain : brancher un service d'extraction réel ici. La façon la plus simple
// avec un modèle multimodal (ex. Claude) est d'envoyer directement le fichier
// (PDF/image) au modèle et de lui demander de renvoyer un tableau JSON
// { categorie, libelle, valeur }[] suivant le même modèle que ci-dessous,
// pré-rempli avec les vraies valeurs extraites au lieu de chaînes vides.
// Le reste du flux (affichage, validation champ par champ, agrégation dans
// InfoCV) n'a pas besoin de changer.

export type ChampCV = {
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
};

const MODELE_CHAMPS_CV: Omit<ChampCV, "valeur">[] = [
  { categorie: "identite", libelle: "Nom complet", ordre: 0 },
  { categorie: "identite", libelle: "Titre / poste actuel", ordre: 1 },
  { categorie: "contact", libelle: "Email", ordre: 2 },
  { categorie: "contact", libelle: "Téléphone", ordre: 3 },
  { categorie: "contact", libelle: "Localisation", ordre: 4 },
  { categorie: "profil", libelle: "Années d'expérience", ordre: 5 },
  { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", ordre: 6 },
  { categorie: "profil", libelle: "Résumé / profil professionnel", ordre: 7 },
  { categorie: "competence", libelle: "Compétences techniques principales", ordre: 8 },
  { categorie: "competence", libelle: "Compétences secondaires / outils", ordre: 9 },
  { categorie: "competence", libelle: "Langues parlées", ordre: 10 },
  { categorie: "experience", libelle: "Expérience 1 (poste, entreprise, dates)", ordre: 11 },
  { categorie: "experience", libelle: "Expérience 2 (poste, entreprise, dates)", ordre: 12 },
  { categorie: "experience", libelle: "Expérience 3 (poste, entreprise, dates)", ordre: 13 },
  { categorie: "formation", libelle: "Diplôme(s) et établissement(s)", ordre: 14 },
  { categorie: "formation", libelle: "Certifications", ordre: 15 },
];

// Point d'entrée appelé après l'upload du CV. Aujourd'hui renvoie simplement
// le modèle vide ; demain, appellera le service d'IA avec le fichier et
// renverra les champs pré-remplis.
export async function extraireInfosCV(_cvUrl: string): Promise<ChampCV[]> {
  return MODELE_CHAMPS_CV.map((champ) => ({ ...champ, valeur: "" }));
}
