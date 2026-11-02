// LOT 6 (28/10/2026) — PROJETS COMPLETS : règles pures (aucun accès Prisma).
//
// Distingue strictement :
//   - un projet À QUALIFIER (informations manquantes signalées) ;
//   - une proposition INDICATIVE (estimation : équipe ENVISAGÉE, budget et
//     délais NON engageants, hypothèses obligatoires) ;
//   - une proposition VÉRIFIÉE (un Admin a confirmé équipe, budget et délais) ;
//   - une proposition ACCEPTÉE par le Client ;
//   - un ENGAGEMENT CONFIRMÉ par ATLAS ;
//   - un projet EN COURS puis TERMINÉ.
// Jamais d'équipe disponible, de tarif ferme ou de date garantie annoncés
// avant vérification.

export type StatutProjetValeur =
  | "A_QUALIFIER"
  | "QUALIFIE"
  | "PROPOSITION_INDICATIVE"
  | "PROPOSITION_VERIFIEE"
  | "ACCEPTEE"
  | "ENGAGEMENT_CONFIRME"
  | "EN_COURS"
  | "TERMINE"
  | "ABANDONNE";

export const LIBELLE_STATUT_PROJET: Record<StatutProjetValeur, string> = {
  A_QUALIFIER: "À qualifier",
  QUALIFIE: "Qualifié — proposition en préparation",
  PROPOSITION_INDICATIVE: "Proposition indicative reçue",
  PROPOSITION_VERIFIEE: "Proposition vérifiée reçue",
  ACCEPTEE: "Proposition acceptée — engagement à confirmer",
  ENGAGEMENT_CONFIRME: "Engagement confirmé",
  EN_COURS: "En cours",
  TERMINE: "Terminé",
  ABANDONNE: "Abandonné",
};

// Étapes affichées au Client (frise), dans l'ordre.
export const ETAPES_PROJET: StatutProjetValeur[] = [
  "A_QUALIFIER",
  "QUALIFIE",
  "PROPOSITION_INDICATIVE",
  "PROPOSITION_VERIFIEE",
  "ACCEPTEE",
  "ENGAGEMENT_CONFIRME",
  "EN_COURS",
  "TERMINE",
];

export type Acteur = "CLIENT" | "ADMIN";

// Transitions MANUELLES autorisées par acteur. Les passages vers
// PROPOSITION_INDICATIVE / PROPOSITION_VERIFIEE découlent de la publication
// d'une proposition (voir publierProposition), ACCEPTEE de la décision du
// Client sur une proposition vérifiée.
const TRANSITIONS: Record<Acteur, Partial<Record<StatutProjetValeur, StatutProjetValeur[]>>> = {
  ADMIN: {
    A_QUALIFIER: ["QUALIFIE", "ABANDONNE"],
    QUALIFIE: ["ABANDONNE"],
    PROPOSITION_INDICATIVE: ["ABANDONNE"],
    PROPOSITION_VERIFIEE: ["ABANDONNE"],
    ACCEPTEE: ["ENGAGEMENT_CONFIRME", "ABANDONNE"],
    ENGAGEMENT_CONFIRME: ["EN_COURS"],
    EN_COURS: ["TERMINE"],
  },
  CLIENT: {
    A_QUALIFIER: ["ABANDONNE"],
    QUALIFIE: ["ABANDONNE"],
    PROPOSITION_INDICATIVE: ["ABANDONNE"],
    PROPOSITION_VERIFIEE: ["ABANDONNE"],
  },
};

export function transitionAutorisee(acteur: Acteur, de: StatutProjetValeur, vers: StatutProjetValeur): boolean {
  return (TRANSITIONS[acteur][de] ?? []).includes(vers);
}

export type ChampsProjet = {
  titre: string;
  objectif: string;
  resultatAttendu: string;
  perimetre: string | null;
  contraintes: string | null;
  exigencesTechniques: string | null;
  calendrierSouhaite: string | null;
  budgetIndicatif: string | null;
};

// Qualification : ce qui MANQUE pour qu'ATLAS puisse construire une
// proposition (bloquant pour passer à QUALIFIE) et ce qui serait utile.
export function informationsManquantes(p: ChampsProjet): { requises: string[]; utiles: string[] } {
  const vide = (v: string | null | undefined) => !v || v.trim().length === 0;
  const requises: string[] = [];
  if (vide(p.objectif)) requises.push("Objectif du projet");
  if (vide(p.resultatAttendu)) requises.push("Résultat attendu");
  if (vide(p.perimetre)) requises.push("Périmètre (ce qui est inclus et exclu)");
  if (vide(p.calendrierSouhaite)) requises.push("Calendrier souhaité");
  const utiles: string[] = [];
  if (vide(p.budgetIndicatif)) utiles.push("Budget indicatif");
  if (vide(p.contraintes)) utiles.push("Contraintes (techniques, réglementaires, organisationnelles)");
  if (vide(p.exigencesTechniques)) utiles.push("Exigences techniques");
  return { requises, utiles };
}

export type RoleEquipe = { role: string; nombre: number; competences: string[] };
export type EtapeProposition = { nom: string; livrables: string[]; dureeEstimee: string | null };

export type ContenuProposition = {
  niveau: "INDICATIVE" | "VERIFIEE";
  approche: string;
  perimetre: string;
  equipe: RoleEquipe[];
  etapes: EtapeProposition[];
  delaiEstime: string | null;
  budgetEstimeMin: number | null;
  budgetEstimeMax: number | null;
  hypotheses: string[];
  exclusions: string[];
};

// Une proposition ne peut être publiée que si elle est honnête sur son
// niveau de certitude : une INDICATIVE énonce ses hypothèses ; une VÉRIFIÉE
// précise l'équipe (rôles), le délai et une fourchette budgétaire.
export function validerProposition(c: ContenuProposition): string[] {
  const erreurs: string[] = [];
  if (!c.approche.trim()) erreurs.push("L'approche est requise.");
  if (!c.perimetre.trim()) erreurs.push("Le périmètre est requis.");
  if (c.etapes.length === 0 || c.etapes.some((e) => !e.nom.trim())) erreurs.push("Au moins une étape nommée est requise.");
  if (c.equipe.some((r) => !r.role.trim() || !Number.isInteger(r.nombre) || r.nombre < 1)) erreurs.push("Chaque rôle de l'équipe doit avoir un nom et un nombre entier positif.");
  if (c.budgetEstimeMin !== null && c.budgetEstimeMax !== null && c.budgetEstimeMin > c.budgetEstimeMax) erreurs.push("Budget : le minimum dépasse le maximum.");
  if ((c.budgetEstimeMin !== null && c.budgetEstimeMin < 0) || (c.budgetEstimeMax !== null && c.budgetEstimeMax < 0)) erreurs.push("Budget : montants négatifs refusés.");
  if (c.niveau === "INDICATIVE" && c.hypotheses.filter((h) => h.trim()).length === 0) {
    erreurs.push("Une proposition indicative doit énoncer ses hypothèses.");
  }
  if (c.niveau === "VERIFIEE") {
    if (c.equipe.length === 0) erreurs.push("Une proposition vérifiée précise l'équipe envisagée.");
    if (!c.delaiEstime?.trim()) erreurs.push("Une proposition vérifiée précise le délai.");
    if (c.budgetEstimeMin === null || c.budgetEstimeMax === null) erreurs.push("Une proposition vérifiée précise une fourchette budgétaire.");
  }
  return erreurs;
}

// Statut du projet après publication d'une proposition de ce niveau.
export function statutApresPublication(niveau: "INDICATIVE" | "VERIFIEE"): StatutProjetValeur {
  return niveau === "VERIFIEE" ? "PROPOSITION_VERIFIEE" : "PROPOSITION_INDICATIVE";
}

// Une proposition peut être publiée à partir d'un projet qualifié ou déjà
// doté d'une proposition (nouvelle version), jamais avant qualification ni
// après acceptation.
export const STATUTS_PERMETTANT_PUBLICATION: StatutProjetValeur[] = ["QUALIFIE", "PROPOSITION_INDICATIVE", "PROPOSITION_VERIFIEE"];
