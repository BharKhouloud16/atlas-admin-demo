import { test, expect } from "@playwright/test";
import { validerPieceJointe, calculerHashPieceJointe, MIME_AUTORISES, TAILLE_MAX_OCTETS } from "@/lib/piece-jointe";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 1). Tests purs de
// lib/piece-jointe.ts — aucune route, aucun stockage, aucune base de
// données. Verrouille l'allowlist MIME, le plafond de taille, la
// cohérence magic-bytes/MIME déclaré, et le calcul du hash.

const PDF_VALIDE = Buffer.from("%PDF-1.4\n%test-content\n");
const PNG_VALIDE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_VALIDE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
const WEBP_VALIDE = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
const DOCX_VALIDE = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
const DOC_LEGACY_VALIDE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00]);

test.describe("COMPANY ATLAS V2.4 — lib/piece-jointe : validation (pure)", () => {
  test("Test 1 — un PDF valide (signature %PDF) est accepté", () => {
    expect(validerPieceJointe("application/pdf", PDF_VALIDE)).toEqual({ ok: true });
  });

  test("Test 2 — un PNG valide est accepté", () => {
    expect(validerPieceJointe("image/png", PNG_VALIDE)).toEqual({ ok: true });
  });

  test("Test 3 — un JPEG valide est accepté", () => {
    expect(validerPieceJointe("image/jpeg", JPEG_VALIDE)).toEqual({ ok: true });
  });

  test("Test 4 — un WEBP valide (RIFF....WEBP) est accepté", () => {
    expect(validerPieceJointe("image/webp", WEBP_VALIDE)).toEqual({ ok: true });
  });

  test("Test 5 — un WEBP dont le conteneur RIFF est absent est rejeté malgré le MIME déclaré", () => {
    const resultat = validerPieceJointe("image/webp", PDF_VALIDE);
    expect(resultat.ok).toBe(false);
  });

  test("Test 6 — un docx (zip PK) est accepté", () => {
    expect(validerPieceJointe("application/vnd.openxmlformats-officedocument.wordprocessingml.document", DOCX_VALIDE)).toEqual({ ok: true });
  });

  test("Test 7 — un doc legacy (OLE Compound File) est accepté", () => {
    expect(validerPieceJointe("application/msword", DOC_LEGACY_VALIDE)).toEqual({ ok: true });
  });

  test("Test 8 — text/plain est accepté sans vérification de signature (aucune signature fiable)", () => {
    expect(validerPieceJointe("text/plain", Buffer.from("contenu texte quelconque"))).toEqual({ ok: true });
  });

  test("Test 9 — un type MIME hors allowlist est rejeté (ex: application/x-executable)", () => {
    const resultat = validerPieceJointe("application/x-executable", PDF_VALIDE);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toContain("non autorisé");
  });

  test("Test 10 — un fichier déclaré PDF mais dont le contenu est en réalité un PNG est rejeté (jamais de confiance dans le seul Content-Type)", () => {
    const resultat = validerPieceJointe("application/pdf", PNG_VALIDE);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toContain("incohérent");
  });

  test("Test 11 — un fichier vide est rejeté", () => {
    const resultat = validerPieceJointe("application/pdf", Buffer.alloc(0));
    expect(resultat.ok).toBe(false);
  });

  test("Test 12 — un fichier dépassant TAILLE_MAX_OCTETS est rejeté", () => {
    const troGros = Buffer.concat([PDF_VALIDE, Buffer.alloc(TAILLE_MAX_OCTETS)]);
    const resultat = validerPieceJointe("application/pdf", troGros);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toContain("volumineux");
  });

  test("Test 13 — un fichier exactement à TAILLE_MAX_OCTETS est accepté (limite inclusive)", () => {
    const octets = Buffer.concat([PDF_VALIDE, Buffer.alloc(TAILLE_MAX_OCTETS - PDF_VALIDE.length)]);
    expect(octets.length).toBe(TAILLE_MAX_OCTETS);
    expect(validerPieceJointe("application/pdf", octets)).toEqual({ ok: true });
  });

  test("Test 14 — calculerHashPieceJointe est déterministe (même entrée -> même hash)", () => {
    const h1 = calculerHashPieceJointe(PDF_VALIDE);
    const h2 = calculerHashPieceJointe(PDF_VALIDE);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("Test 15 — calculerHashPieceJointe distingue deux contenus différents", () => {
    expect(calculerHashPieceJointe(PDF_VALIDE)).not.toBe(calculerHashPieceJointe(PNG_VALIDE));
  });

  test("Test 16 — MIME_AUTORISES est un vocabulaire fermé attendu (9 types)", () => {
    expect(MIME_AUTORISES.length).toBe(9);
    expect(MIME_AUTORISES).toContain("application/pdf");
  });
});
