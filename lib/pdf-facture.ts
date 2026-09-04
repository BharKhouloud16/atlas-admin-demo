import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { libelleMois } from "@/lib/feuilles-de-temps";

// Génère la facture PDF correspondant à un CRA définitivement validé
// (statut ValideeClient, voir prisma/schema.prisma FeuilleDeTemps et
// PATCH /api/feuilles-de-temps action=validerClient) : c'est le document
// que l'Admin transmet au client pour règlement, une fois le circuit de
// double validation terminé. Le montant facturé se base sur le TJM de vente
// négocié pour la mission (Mission.tjmVente), pas sur le TJM interne de
// l'ingénieur, et sur les jours réellement déclarés/validés (pas nbJours,
// qui est la durée prévisionnelle de la mission).

const BLEU_FONCE = rgb(0x12 / 255, 0x22 / 255, 0x4a / 255);
const GRIS = rgb(0x4b / 255, 0x55 / 255, 0x67 / 255);
const GRIS_CLAIR = rgb(0xe4 / 255, 0xe7 / 255, 0xee / 255);
const FOND_CLAIR = rgb(0xf6 / 255, 0xf7 / 255, 0xfb / 255);

const MARGE = 50;
const LARGEUR_PAGE = 595.28;
const HAUTEUR_PAGE = 841.89;

export type DonneesFactureExport = {
  numero: string;
  dateEmission: Date;
  mois: string; // "AAAA-MM"
  clientNom: string;
  clientAdresse: string | null; // pays, à défaut d'une adresse structurée (voir Client.pays)
  missionRepere: string | null;
  ingenieurNom: string;
  joursTravailles: number;
  heuresSupplementaires: number;
  tjmVente: number;
  deviseTjm?: string; // EUR par défaut
};

function formaterMontant(montant: number, devise: string): string {
  return `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export async function genererFacturePdf(d: DonneesFactureExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Facture ${d.numero}`);
  doc.setProducer("Atlas Quality Partners");

  const police = await doc.embedFont(StandardFonts.Helvetica);
  const policeGrasse = await doc.embedFont(StandardFonts.HelveticaBold);
  const devise = d.deviseTjm ?? "EUR";

  const page = doc.addPage([LARGEUR_PAGE, HAUTEUR_PAGE]);
  let y = HAUTEUR_PAGE - MARGE;

  // En-tête
  page.drawText("ATLAS QUALITY PARTNERS", { x: MARGE, y, size: 16, font: policeGrasse, color: BLEU_FONCE });
  page.drawText("FACTURE", {
    x: LARGEUR_PAGE - MARGE - policeGrasse.widthOfTextAtSize("FACTURE", 20),
    y,
    size: 20,
    font: policeGrasse,
    color: BLEU_FONCE,
  });
  y -= 20;
  page.drawText("Conseil & prestations informatiques", { x: MARGE, y, size: 10, font: police, color: GRIS });
  y -= 40;

  // Bloc infos facture (numéro, date, mission, période) à gauche ; bloc
  // client à droite.
  const yBlocs = y;
  page.drawText("Facturé à", { x: MARGE, y, size: 9, font: policeGrasse, color: GRIS });
  page.drawText(`N° facture : ${d.numero}`, { x: 320, y, size: 9, font: policeGrasse, color: GRIS });
  y -= 14;
  page.drawText(d.clientNom, { x: MARGE, y, size: 11, font: policeGrasse, color: BLEU_FONCE });
  page.drawText(`Date d'émission : ${d.dateEmission.toLocaleDateString("fr-FR")}`, { x: 320, y, size: 9, font: police, color: GRIS });
  y -= 14;
  if (d.clientAdresse) {
    page.drawText(d.clientAdresse, { x: MARGE, y, size: 9, font: police, color: GRIS });
  }
  page.drawText(`Période : ${libelleMois(d.mois)}`, { x: 320, y, size: 9, font: police, color: GRIS });
  y -= 14;
  if (d.missionRepere) {
    page.drawText(`Mission : ${d.missionRepere}`, { x: 320, y, size: 9, font: police, color: GRIS });
    y -= 14;
  }
  page.drawText(`Intervenant : ${d.ingenieurNom}`, { x: 320, y, size: 9, font: police, color: GRIS });
  y = Math.min(y, yBlocs - 70);
  y -= 30;

  // Tableau : une ligne "jours travaillés" + une ligne "heures sup." si
  // applicable, chacune au TJM (ou à sa fraction horaire).
  const colX = { designation: MARGE, quantite: 330, prixUnitaire: 400, total: 480 };
  page.drawRectangle({ x: MARGE, y: y - 22, width: LARGEUR_PAGE - MARGE * 2, height: 22, color: BLEU_FONCE });
  page.drawText("Désignation", { x: colX.designation + 6, y: y - 16, size: 9, font: policeGrasse, color: rgb(1, 1, 1) });
  page.drawText("Quantité", { x: colX.quantite, y: y - 16, size: 9, font: policeGrasse, color: rgb(1, 1, 1) });
  page.drawText("Prix unitaire", { x: colX.prixUnitaire, y: y - 16, size: 9, font: policeGrasse, color: rgb(1, 1, 1) });
  page.drawText("Total", { x: colX.total, y: y - 16, size: 9, font: policeGrasse, color: rgb(1, 1, 1) });
  y -= 22;

  const totalJours = d.joursTravailles * d.tjmVente;
  const tjmHoraire = d.tjmVente / 8;
  const totalHeuresSup = d.heuresSupplementaires * tjmHoraire;

  function ligneTableau(designation: string, quantite: string, prixUnitaire: string, total: string, fond: boolean) {
    if (fond) page.drawRectangle({ x: MARGE, y: y - 20, width: LARGEUR_PAGE - MARGE * 2, height: 20, color: FOND_CLAIR });
    page.drawText(designation, { x: colX.designation + 6, y: y - 15, size: 9, font: police, color: GRIS });
    page.drawText(quantite, { x: colX.quantite, y: y - 15, size: 9, font: police, color: GRIS });
    page.drawText(prixUnitaire, { x: colX.prixUnitaire, y: y - 15, size: 9, font: police, color: GRIS });
    page.drawText(total, { x: colX.total, y: y - 15, size: 9, font: police, color: GRIS });
    y -= 20;
  }

  ligneTableau(
    `Prestation — ${libelleMois(d.mois)}`,
    `${d.joursTravailles} j`,
    formaterMontant(d.tjmVente, devise),
    formaterMontant(totalJours, devise),
    true
  );
  if (d.heuresSupplementaires > 0) {
    ligneTableau(
      "Heures supplémentaires",
      `${d.heuresSupplementaires} h`,
      formaterMontant(tjmHoraire, devise),
      formaterMontant(totalHeuresSup, devise),
      false
    );
  }

  y -= 10;
  page.drawLine({ start: { x: MARGE, y }, end: { x: LARGEUR_PAGE - MARGE, y }, thickness: 0.75, color: GRIS_CLAIR });
  y -= 20;

  const totalGeneral = totalJours + totalHeuresSup;
  page.drawText("Total HT (TVA non applicable, art. 293B du CGI ou équivalent)", {
    x: MARGE,
    y,
    size: 8,
    font: police,
    color: GRIS,
  });
  page.drawText(formaterMontant(totalGeneral, devise), {
    x: colX.total,
    y,
    size: 12,
    font: policeGrasse,
    color: BLEU_FONCE,
  });
  y -= 40;

  page.drawText(
    "Facture générée automatiquement à partir d'un compte-rendu d'activité validé par l'Admin et le Client.",
    { x: MARGE, y, size: 8, font: police, color: GRIS_CLAIR }
  );

  return doc.save();
}
