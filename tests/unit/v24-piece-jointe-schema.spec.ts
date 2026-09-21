import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — V2.4 (21/09/2026) : tests SCHÉMA UNIQUEMENT pour
// PieceJointe (Lot 0). Ce fichier n'exerce AUCUN comportement applicatif :
// aucune route, aucun upload/téléchargement, aucune logique d'accès,
// aucun scanner. Vérifie uniquement que le modèle additif, la cardinalité
// 1 Message -> N PieceJointe, l'intégrité référentielle (FK messageId) et
// les valeurs de StatutScanPieceJointe se comportent comme conçu.

async function creerMessageDeTest(clientId: string) {
  return prisma.message.create({
    data: { clientId, auteurRole: "CLIENT", contenu: `Message de test V2.4 ${nouveauCorrelationId()}` },
  });
}

test.describe("COMPANY ATLAS V2.4 Lot 0 — PieceJointe (schéma uniquement)", () => {
  test("Test 1 — une PieceJointe peut être créée pour un Message, statutScan NON_SCANNE par défaut, supprimeLe null", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    expect(client).toBeTruthy();
    const message = await creerMessageDeTest(client!.id);

    const piece = await prisma.pieceJointe.create({
      data: {
        messageId: message.id,
        nomFichier: "cahier-des-charges.pdf",
        mimeType: "application/pdf",
        tailleOctets: 12345,
        hash: "a".repeat(64),
        fileUrl: "pieces-jointes/test-1234-cahier-des-charges.pdf",
      },
    });

    expect(piece.messageId).toBe(message.id);
    expect(piece.nomFichier).toBe("cahier-des-charges.pdf");
    expect(piece.mimeType).toBe("application/pdf");
    expect(piece.tailleOctets).toBe(12345);
    expect(piece.statutScan).toBe("NON_SCANNE");
    expect(piece.supprimeLe).toBeNull();
  });

  test("Test 2 — un même Message peut avoir plusieurs PieceJointe (cardinalité 1 -> N)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const message = await creerMessageDeTest(client!.id);

    await prisma.pieceJointe.create({
      data: { messageId: message.id, nomFichier: "a.pdf", mimeType: "application/pdf", tailleOctets: 100, hash: "a".repeat(64), fileUrl: "pieces-jointes/a.pdf" },
    });
    await prisma.pieceJointe.create({
      data: { messageId: message.id, nomFichier: "b.png", mimeType: "image/png", tailleOctets: 200, hash: "b".repeat(64), fileUrl: "pieces-jointes/b.png" },
    });

    const pieces = await prisma.pieceJointe.findMany({ where: { messageId: message.id } });
    expect(pieces.length).toBe(2);
    expect(pieces.map((p) => p.nomFichier).sort()).toEqual(["a.pdf", "b.png"]);
  });

  test("Test 3 — l'ownership n'est jamais stocké sur PieceJointe : il se dérive uniquement via message.clientId", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const message = await creerMessageDeTest(client!.id);
    const piece = await prisma.pieceJointe.create({
      data: { messageId: message.id, nomFichier: "c.pdf", mimeType: "application/pdf", tailleOctets: 300, hash: "c".repeat(64), fileUrl: "pieces-jointes/c.pdf" },
    });

    const pieceAvecOwnership = await prisma.pieceJointe.findUnique({
      where: { id: piece.id },
      include: { message: { select: { clientId: true } } },
    });
    expect(pieceAvecOwnership?.message.clientId).toBe(client!.id);
    // Vérification structurelle : PieceJointe elle-même ne porte aucun champ
    // clientId — seul le chemin via message.clientId ci-dessus existe.
    expect(Object.prototype.hasOwnProperty.call(piece, "clientId")).toBe(false);
  });

  test("Test 4 — les 4 valeurs de StatutScanPieceJointe sont utilisables (interface future, aucun scanner ne les produit dans ce lot)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const message = await creerMessageDeTest(client!.id);

    const statuts = ["NON_SCANNE", "PROPRE", "SUSPECT", "ERREUR_SCAN"] as const;
    for (const statutScan of statuts) {
      const piece = await prisma.pieceJointe.create({
        data: {
          messageId: message.id,
          nomFichier: `fichier-${statutScan}.pdf`,
          mimeType: "application/pdf",
          tailleOctets: 1,
          hash: statutScan.padEnd(64, "0"),
          fileUrl: `pieces-jointes/${statutScan}.pdf`,
          statutScan,
        },
      });
      expect(piece.statutScan).toBe(statutScan);
    }

    const pieces = await prisma.pieceJointe.findMany({ where: { messageId: message.id } });
    expect(pieces.length).toBe(4);
  });

  test("Test 5 — messageId doit référencer un Message existant (contrainte FK PostgreSQL, jamais une pièce orpheline)", async () => {
    let aEchoue = false;
    try {
      await prisma.pieceJointe.create({
        data: {
          messageId: "message-inexistant-jamais-cree",
          nomFichier: "orpheline.pdf",
          mimeType: "application/pdf",
          tailleOctets: 1,
          hash: "d".repeat(64),
          fileUrl: "pieces-jointes/orpheline.pdf",
        },
      });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "la contrainte FK messageId doit rejeter toute PieceJointe sans Message réel").toBe(true);

    const pieces = await prisma.pieceJointe.findMany({ where: { fileUrl: "pieces-jointes/orpheline.pdf" } });
    expect(pieces.length).toBe(0);
  });

  test("Test 6 — supprimeLe marque une suppression LOGIQUE uniquement : la ligne reste lisible, jamais un DELETE", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const message = await creerMessageDeTest(client!.id);
    const piece = await prisma.pieceJointe.create({
      data: { messageId: message.id, nomFichier: "e.pdf", mimeType: "application/pdf", tailleOctets: 400, hash: "e".repeat(64), fileUrl: "pieces-jointes/e.pdf" },
    });

    const maintenant = new Date();
    const pieceMarqueeSupprimee = await prisma.pieceJointe.update({ where: { id: piece.id }, data: { supprimeLe: maintenant } });
    expect(pieceMarqueeSupprimee.supprimeLe).not.toBeNull();

    // La ligne reste physiquement présente et lisible — jamais un DELETE.
    const pieceRelue = await prisma.pieceJointe.findUnique({ where: { id: piece.id } });
    expect(pieceRelue).not.toBeNull();
    expect(pieceRelue!.nomFichier).toBe("e.pdf");
  });

  test("Test 7 — Message.pieceJointes expose la relation inverse sans modifier les champs existants de Message", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const message = await creerMessageDeTest(client!.id);
    await prisma.pieceJointe.create({
      data: { messageId: message.id, nomFichier: "f.pdf", mimeType: "application/pdf", tailleOctets: 500, hash: "f".repeat(64), fileUrl: "pieces-jointes/f.pdf" },
    });

    const messageAvecPieces = await prisma.message.findUnique({ where: { id: message.id }, include: { pieceJointes: true } });
    expect(messageAvecPieces?.pieceJointes.length).toBe(1);
    // Champs existants de Message intacts (append-only, jamais modifiés par ce lot).
    expect(messageAvecPieces?.clientId).toBe(client!.id);
    expect(messageAvecPieces?.auteurRole).toBe("CLIENT");
  });

  test("Test 8 — isolation : les PieceJointe d'un Message d'un autre Client ne remontent jamais dans le filtrage par messageId d'un Client donné", async () => {
    const clientA = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const clientB = await prisma.client.findFirst({
      where: { compte: { email: { not: "client-demo@example.com" } }, id: { not: clientA!.id } },
    });
    expect(clientB, "un deuxième client de démo distinct est nécessaire pour ce test d'isolation").toBeTruthy();

    const messageA = await creerMessageDeTest(clientA!.id);
    const messageB = await creerMessageDeTest(clientB!.id);

    await prisma.pieceJointe.create({
      data: { messageId: messageA.id, nomFichier: "clientA.pdf", mimeType: "application/pdf", tailleOctets: 1, hash: "1".repeat(64), fileUrl: "pieces-jointes/clientA.pdf" },
    });
    await prisma.pieceJointe.create({
      data: { messageId: messageB.id, nomFichier: "clientB.pdf", mimeType: "application/pdf", tailleOctets: 1, hash: "2".repeat(64), fileUrl: "pieces-jointes/clientB.pdf" },
    });

    const piecesDeA = await prisma.pieceJointe.findMany({ where: { messageId: messageA.id } });
    expect(piecesDeA.length).toBe(1);
    expect(piecesDeA[0].nomFichier).toBe("clientA.pdf");
  });
});
