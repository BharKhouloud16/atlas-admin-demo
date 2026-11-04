// Extraction DÉTERMINISTE d'un CV — simulation réservée à la CI (voir
// lib/simulation-ci.ts). Remplace l'appel à l'API Claude par une lecture
// directe du texte d'un PDF de test non compressé, au format :
//   « <libellé exact du modèle> : <valeur> »   (ex. « Nom complet : Camille Fictif »)
//   « Secteur : <domaine> »                      (facultatif, contrôle hors secteur)
// Les PDF de test (tests/fixtures/cv-fictif.ts) ne contiennent que des
// données fictives. Aucune donnée n'est inventée : un champ absent du PDF
// reste vide, comme avec l'extraction réelle.
import { modeleChampsVides, type ResultatExtractionCV } from "@/lib/cv-extraction";

const SECTEURS_INFORMATIQUES = /informati|logiciel|software|qa|test|développement|developpement|devops|cloud|data|cyber|it\b/i;

// Texte des opérateurs « (...) Tj » d'un PDF non compressé, une entrée par ligne.
export function texteLignesPdf(pdf: Uint8Array): string[] {
  const brut = Buffer.from(pdf).toString("latin1");
  const lignes: string[] = [];
  const motif = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(brut)) !== null) {
    lignes.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return lignes;
}

export function extraireInfosCvSimulation(pdfBase64: string): ResultatExtractionCV {
  const lignes = texteLignesPdf(Buffer.from(pdfBase64, "base64"));
  const valeurs = new Map<string, string>();
  for (const ligne of lignes) {
    const separateur = ligne.indexOf(" : ");
    if (separateur === -1) continue;
    valeurs.set(ligne.slice(0, separateur).trim(), ligne.slice(separateur + 3).trim());
  }

  const secteur = valeurs.get("Secteur") ?? "";
  if (secteur && !SECTEURS_INFORMATIQUES.test(secteur)) {
    return { horsSecteur: true, secteurDetecte: secteur, champs: modeleChampsVides() };
  }

  return {
    horsSecteur: false,
    secteurDetecte: secteur,
    champs: modeleChampsVides().map((champ) => ({ ...champ, valeur: valeurs.get(champ.libelle) ?? "" })),
  };
}
