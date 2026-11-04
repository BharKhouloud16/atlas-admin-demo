// PDF de CV FICTIFS pour les tests (extraction déterministe, voir
// lib/cv-extraction-simulation.ts). Aucune donnée personnelle réelle : noms
// inventés, adresses en domaine réservé « .invalid », téléphone fictif.
// PDF minimal non compressé (police standard Helvetica, encodage WinAnsi).

export type LigneCv = [libelle: string, valeur: string];

export function genererPdfCv(lignes: LigneCv[]): Buffer {
  const echapper = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const texte = lignes.map(([libelle, valeur]) => `(${echapper(`${libelle} : ${valeur}`)}) Tj T*`).join("\n");
  const flux = `BT /F1 10 Tf 14 TL 40 800 Td\n${texte}\nET`;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(flux, "latin1")} >>\nstream\n${flux}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const positions: number[] = [];
  objets.forEach((objet, i) => {
    positions.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objet}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  pdf += positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// CV fictif d'un ingénieur QA. Compétences choisies dans lib/competences.ts
// et rares dans les autres jeux de test, pour identifier sans ambiguïté ce
// profil dans les solutions proposées au Client.
export function cvIngenieurFictif(suffixe: string): { pdf: Buffer; lignes: LigneCv[] } {
  const lignes: LigneCv[] = [
    ["Secteur", "Test logiciel / QA"],
    ["Nom complet", `Camille Fictif ${suffixe}`],
    ["Titre / poste actuel", "Ingénieure QA automatisation"],
    ["Email", `camille.fictif.${suffixe}@example.invalid`],
    ["Téléphone", "+33 1 00 00 00 00"],
    ["Localisation", "Lyon, France"],
    ["Années d'expérience", "7"],
    ["Séniorité (Junior / Confirmé / Senior / Expert)", "Senior"],
    ["Résumé / profil professionnel", "Automatisation de tests d'API et qualité logicielle."],
    ["Compétences techniques principales", "SoapUI, SonarQube"],
    ["Compétences secondaires / outils", "Jira, Confluence"],
    ["Langues parlées", "Français, anglais"],
    ["Expérience 1 (poste, entreprise, dates)", "Ingénieure QA, Entreprise Fictive A, 2020-2026"],
    ["Expérience 2 (poste, entreprise, dates)", "Testeuse, Entreprise Fictive B, 2017-2020"],
    ["Expérience 3 (poste, entreprise, dates)", "Stagiaire QA, Entreprise Fictive C, 2016-2017"],
    ["Diplôme(s) et établissement(s)", "Master informatique, Université Fictive"],
    ["Certifications", "ISTQB Foundation"],
  ];
  return { pdf: genererPdfCv(lignes), lignes };
}

export function cvHorsSecteurFictif(): Buffer {
  return genererPdfCv([
    ["Secteur", "Restauration"],
    ["Nom complet", "Dominique Fictif"],
    ["Titre / poste actuel", "Chef de cuisine"],
  ]);
}
