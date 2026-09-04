import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";

// Génère un export PDF "CV Atlas" — une mise en forme homogène (même charte
// que le reste de la plateforme, voir lib/theme.ts) du profil validé d'un
// ingénieur, construite à partir des InfoCV validées plutôt que du CV brut
// importé (qui peut être dans n'importe quel format/mise en page). Utile
// pour l'Admin qui veut transmettre une fiche présentable à un client sans
// exposer le CV original (coordonnées personnelles, mise en page parfois peu
// professionnelle, etc.).

const BLEU = rgb(0x25 / 255, 0x57 / 255, 0xd6 / 255);
const BLEU_FONCE = rgb(0x12 / 255, 0x22 / 255, 0x4a / 255);
const GRIS = rgb(0x4b / 255, 0x55 / 255, 0x67 / 255);
const GRIS_CLAIR = rgb(0xe4 / 255, 0xe7 / 255, 0xee / 255);

const MARGE = 50;
const LARGEUR_PAGE = 595.28; // A4 portrait, points
const HAUTEUR_PAGE = 841.89;
const LARGEUR_UTILE = LARGEUR_PAGE - MARGE * 2;

export type InfoCvExport = { categorie: string; libelle: string; valeur: string };
export type RealisationExport = { titre: string; description: string | null; lien: string | null };

export type DonneesCvExport = {
  nom: string;
  prenom: string | null;
  seniorite: string | null;
  anneesExperience: number | null;
  competences: string[];
  infos: InfoCvExport[]; // uniquement les InfoCV validées, déjà triées par ordre
  realisations: RealisationExport[];
};

const LABEL_CATEGORIE: Record<string, string> = {
  identite: "Identité",
  contact: "Contact",
  profil: "Profil",
  competence: "Compétences",
  experience: "Expérience professionnelle",
  formation: "Formation",
};
const ORDRE_CATEGORIES = ["identite", "profil", "competence", "experience", "formation", "contact"];

// Découpe un texte en lignes qui tiennent dans `largeurMax` avec la police et
// la taille données — pdf-lib ne fait pas de retour à la ligne automatique.
function decouperTexte(texte: string, police: PDFFont, taille: number, largeurMax: number): string[] {
  const mots = texte.replace(/\r/g, "").split(/\s+/).filter(Boolean);
  const lignes: string[] = [];
  let ligneActuelle = "";
  for (const mot of mots) {
    const essai = ligneActuelle ? `${ligneActuelle} ${mot}` : mot;
    if (police.widthOfTextAtSize(essai, taille) > largeurMax && ligneActuelle) {
      lignes.push(ligneActuelle);
      ligneActuelle = mot;
    } else {
      ligneActuelle = essai;
    }
  }
  if (ligneActuelle) lignes.push(ligneActuelle);
  return lignes;
}

export async function genererCvPdf(donnees: DonneesCvExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`CV Atlas — ${donnees.prenom ?? ""} ${donnees.nom}`.trim());
  doc.setProducer("Atlas Quality Partners");

  const policeNormale = await doc.embedFont(StandardFonts.Helvetica);
  const policeGrasse = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([LARGEUR_PAGE, HAUTEUR_PAGE]);
  let y = HAUTEUR_PAGE - MARGE;

  function nouvellePage() {
    page = doc.addPage([LARGEUR_PAGE, HAUTEUR_PAGE]);
    y = HAUTEUR_PAGE - MARGE;
  }

  function assurerEspace(hauteurNecessaire: number) {
    if (y - hauteurNecessaire < MARGE) nouvellePage();
  }

  function ecrireTitre(texte: string, taille: number, police: PDFFont, couleur = BLEU_FONCE, interligne = 4) {
    assurerEspace(taille + interligne);
    page.drawText(texte, { x: MARGE, y: y - taille, size: taille, font: police, color: couleur });
    y -= taille + interligne;
  }

  function ecrireParagraphe(texte: string, taille = 10, couleur = GRIS, indent = 0) {
    const lignes = decouperTexte(texte, policeNormale, taille, LARGEUR_UTILE - indent);
    for (const ligne of lignes) {
      assurerEspace(taille + 3);
      page.drawText(ligne, { x: MARGE + indent, y: y - taille, size: taille, font: policeNormale, color: couleur });
      y -= taille + 3;
    }
  }

  // En-tête : bandeau bleu foncé "Atlas Quality Partners" + nom en grand.
  page.drawRectangle({ x: 0, y: HAUTEUR_PAGE - 90, width: LARGEUR_PAGE, height: 90, color: BLEU_FONCE });
  page.drawText("ATLAS QUALITY PARTNERS", {
    x: MARGE,
    y: HAUTEUR_PAGE - 34,
    size: 11,
    font: policeGrasse,
    color: rgb(1, 1, 1),
  });
  const nomComplet = `${donnees.prenom ?? ""} ${donnees.nom}`.trim();
  page.drawText(nomComplet, {
    x: MARGE,
    y: HAUTEUR_PAGE - 66,
    size: 22,
    font: policeGrasse,
    color: rgb(1, 1, 1),
  });
  const sousTitreParts = [donnees.seniorite, donnees.anneesExperience != null ? `${donnees.anneesExperience} ans d'expérience` : null].filter(
    Boolean
  );
  if (sousTitreParts.length) {
    page.drawText(sousTitreParts.join(" — "), {
      x: MARGE,
      y: HAUTEUR_PAGE - 82,
      size: 11,
      font: policeNormale,
      color: rgb(0.85, 0.88, 0.96),
    });
  }
  y = HAUTEUR_PAGE - 90 - 28;

  // Compétences (tags), affichées juste sous l'en-tête si renseignées.
  if (donnees.competences.length > 0) {
    ecrireTitre("Compétences clés", 12, policeGrasse);
    ecrireParagraphe(donnees.competences.join("  •  "), 10, GRIS);
    y -= 10;
  }

  // Sections issues des InfoCV validées, groupées par catégorie dans un
  // ordre de lecture naturel (identité/profil d'abord, contact en dernier —
  // l'export sert à présenter le profil à un client, pas à le contacter
  // directement).
  const parCategorie = new Map<string, InfoCvExport[]>();
  for (const info of donnees.infos) {
    if (!parCategorie.has(info.categorie)) parCategorie.set(info.categorie, []);
    parCategorie.get(info.categorie)!.push(info);
  }

  for (const cle of ORDRE_CATEGORIES) {
    const infos = parCategorie.get(cle);
    if (!infos || infos.length === 0) continue;
    y -= 6;
    page.drawLine({ start: { x: MARGE, y }, end: { x: LARGEUR_PAGE - MARGE, y }, thickness: 0.75, color: GRIS_CLAIR });
    y -= 14;
    ecrireTitre(LABEL_CATEGORIE[cle] ?? cle, 13, policeGrasse, BLEU);
    for (const info of infos) {
      ecrireTitre(info.libelle, 10, policeGrasse, BLEU_FONCE, 2);
      ecrireParagraphe(info.valeur, 10, GRIS, 4);
      y -= 4;
    }
  }

  // Réalisations (portfolio, voir Profil.realisations) — en fin de document,
  // à la manière d'une section "projets" d'un CV classique.
  if (donnees.realisations.length > 0) {
    y -= 6;
    page.drawLine({ start: { x: MARGE, y }, end: { x: LARGEUR_PAGE - MARGE, y }, thickness: 0.75, color: GRIS_CLAIR });
    y -= 14;
    ecrireTitre("Réalisations", 13, policeGrasse, BLEU);
    for (const r of donnees.realisations) {
      ecrireTitre(r.titre, 10, policeGrasse, BLEU_FONCE, 2);
      if (r.description) ecrireParagraphe(r.description, 10, GRIS, 4);
      if (r.lien) ecrireParagraphe(r.lien, 9, BLEU, 4);
      y -= 4;
    }
  }

  // Pied de page sur chaque page : mention de génération.
  const pages = doc.getPages();
  const genereLe = new Date().toLocaleDateString("fr-FR");
  pages.forEach((p, i) => {
    p.drawText(`Généré par Atlas Quality Partners le ${genereLe} — page ${i + 1}/${pages.length}`, {
      x: MARGE,
      y: 24,
      size: 8,
      font: policeNormale,
      color: GRIS_CLAIR,
    });
  });

  return doc.save();
}
