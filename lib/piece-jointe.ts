import crypto from "crypto";
import { MIME_AUTORISES, TAILLE_MAX_OCTETS, type MimeAutorise } from "./piece-jointe-constants";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 1).
//
// Validation strictement AVANT tout appel à uploaderFichier() (voir
// lib/storage.ts, qui ne valide ni MIME ni taille lui-même — laissé aux
// appelants, voir audit V2.4) : allowlist MIME fermée + plafond de taille
// explicite en dur (même patron que app/api/ingenieur/video/route.ts,
// TAILLE_MAX_OCTETS ; constantes partagées avec le client dans
// lib/piece-jointe-constants.ts, qui n'importe pas "crypto" pour rester
// bundlable côté navigateur) + vérification des premiers octets (magic
// bytes) quand une signature fiable existe pour le type déclaré — jamais
// une confiance aveugle dans le Content-Type fourni par le navigateur
// (règle explicite du mandat V2.4). text/plain n'a aucune signature
// fiable et n'est donc validé que sur la déclaration MIME + la taille.
export { MIME_AUTORISES, TAILLE_MAX_OCTETS };
export type { MimeAutorise };

type Signature = { mime: MimeAutorise; octets: number[] };

// PK\x03\x04 est la signature ZIP générique : docx/xlsx (formats
// OpenXML) sont des zips, donc indiscernables entre eux par les seuls
// octets — la distinction repose ici sur le Content-Type déclaré, comme
// documenté ; la vérification magic-bytes confirme seulement "c'est bien
// un zip", pas "c'est précisément ce sous-format".
const SIGNATURES: Signature[] = [
  { mime: "application/pdf", octets: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/png", octets: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", octets: [0xff, 0xd8, 0xff] },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", octets: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", octets: [0x50, 0x4b, 0x03, 0x04] },
  // OLE Compound File — formats legacy .doc/.xls.
  { mime: "application/msword", octets: [0xd0, 0xcf, 0x11, 0xe0] },
  { mime: "application/vnd.ms-excel", octets: [0xd0, 0xcf, 0x11, 0xe0] },
];

function correspondSignature(octets: Buffer, signature: number[]): boolean {
  if (octets.length < signature.length) return false;
  return signature.every((valeur, i) => octets[i] === valeur);
}

// image/webp : conteneur RIFF avec l'identifiant "WEBP" au décalage 8 —
// signature à deux segments, traitée séparément des signatures simples
// ci-dessus.
function estWebpValide(octets: Buffer): boolean {
  if (octets.length < 12) return false;
  return octets.subarray(0, 4).toString("ascii") === "RIFF" && octets.subarray(8, 12).toString("ascii") === "WEBP";
}

export type ResultatValidationPieceJointe = { ok: true } | { ok: false; erreur: string };

export function validerPieceJointe(mimeDeclare: string, octets: Buffer): ResultatValidationPieceJointe {
  if (!(MIME_AUTORISES as readonly string[]).includes(mimeDeclare)) {
    return { ok: false, erreur: "Type de fichier non autorisé." };
  }
  if (octets.length === 0) {
    return { ok: false, erreur: "Fichier vide." };
  }
  if (octets.length > TAILLE_MAX_OCTETS) {
    return { ok: false, erreur: "Fichier trop volumineux (15 Mo maximum)." };
  }

  if (mimeDeclare === "text/plain") {
    return { ok: true };
  }
  if (mimeDeclare === "image/webp") {
    return estWebpValide(octets) ? { ok: true } : { ok: false, erreur: "Contenu du fichier incohérent avec son type déclaré." };
  }

  const signaturesAttendues = SIGNATURES.filter((s) => s.mime === mimeDeclare);
  const coherent = signaturesAttendues.some((s) => correspondSignature(octets, s.octets));
  if (!coherent) {
    return { ok: false, erreur: "Contenu du fichier incohérent avec son type déclaré." };
  }
  return { ok: true };
}

export function calculerHashPieceJointe(octets: Buffer): string {
  return crypto.createHash("sha256").update(octets).digest("hex");
}
