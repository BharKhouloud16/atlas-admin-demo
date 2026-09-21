import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lots 1-4) — API.
//
// ENVIRONNEMENT (comme pour tests/api/client-completion-c4-c6-c7.spec.ts,
// Document) : BLOB_READ_WRITE_TOKEN n'est configuré ni en local ni en CI
// pour ce dépôt — uploaderFichier()/obtenirFichier() échouent donc
// systématiquement ici. Le "chemin heureux" (upload/téléchargement 200/201
// avec stockage réel) n'est structurellement pas exerçable dans cet
// environnement, exactement comme pour Document. Chaque route valide
// pourtant AVANT tout appel au stockage (MIME/taille/magic-bytes/RBAC/
// IDOR) : ces chemins sont testés intégralement ci-dessous ; le chemin de
// stockage lui-même est verrouillé sur son échec propre (503, jamais un
// crash, jamais de ligne PieceJointe orpheline), comme le fait déjà la
// suite Document.
//
// Aucun login superflu : storageState (voir tests/setup/auth.setup.ts)
// consommé pour toute précondition de rôle — aucun test ici ne teste
// l'authentification elle-même.

const PDF_VALIDE = Buffer.from("%PDF-1.4\n%test-content\n");
const PNG_VALIDE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  expect(client).toBeTruthy();
  return client!;
}

async function creerAutreClient() {
  return prisma.client.create({ data: { nom: `Client V2.4 Test ${Date.now()}-${Math.random()}` } });
}

async function creerMessage(clientId: string, auteurRole: "CLIENT" | "ADMIN" = "CLIENT") {
  return prisma.message.create({ data: { clientId, auteurRole, contenu: `Message V2.4 ${nouveauCorrelationId()}` } });
}

async function creerPieceDeTest(messageId: string, overrides: { supprimeLe?: Date } = {}) {
  return prisma.pieceJointe.create({
    data: {
      messageId,
      nomFichier: "document-test.pdf",
      mimeType: "application/pdf",
      tailleOctets: PDF_VALIDE.length,
      hash: "0".repeat(64),
      fileUrl: `https://blob.example/pieces-jointes/${Date.now()}-document-test.pdf`,
      ...overrides,
    },
  });
}

test.describe("V2.4 — Lot 1 : POST /api/client/messages/[id]/pieces-jointes (upload Client)", () => {
  test("non authentifié -> 403", async ({ request }) => {
    const message = await creerMessage((await clientDemo()).id);
    const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
      multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
    });
    expect(reponse.status()).toBe(403);
  });

  test.describe("Admin", () => {
    test.use({ storageState: ADMIN_STATE });
    test("ADMIN -> 403 (cette route est réservée Client)", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(403);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("INGENIEUR -> 403 (jamais d'accès à la messagerie Client)", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(403);
    });
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });

    test("IDOR : message appartenant à un autre client -> 404, jamais une fuite d'existence", async ({ request }) => {
      const autreClient = await creerAutreClient();
      const messageEtranger = await creerMessage(autreClient.id);
      const reponse = await request.post(`/api/client/messages/${messageEtranger.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(404);
    });

    test("message inexistant -> 404", async ({ request }) => {
      const reponse = await request.post(`/api/client/messages/message-inexistant/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(404);
    });

    test("aucun fichier fourni -> 400", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, { multipart: {} });
      expect(reponse.status()).toBe(400);
    });

    test("MIME hors allowlist -> 400, aucune PieceJointe créée", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const avant = await prisma.pieceJointe.count();
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "script.exe", mimeType: "application/x-executable", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(400);
      expect(await prisma.pieceJointe.count()).toBe(avant);
    });

    test("contenu incohérent avec le MIME déclaré -> 400 (jamais de confiance dans le seul Content-Type)", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        // Déclaré PDF, contenu réel PNG.
        multipart: { fichier: { name: "faux.pdf", mimeType: "application/pdf", buffer: PNG_VALIDE } },
      });
      expect(reponse.status()).toBe(400);
    });

    test("taille dépassée -> 400", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const troGros = Buffer.concat([PDF_VALIDE, Buffer.alloc(16 * 1024 * 1024)]);
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "gros.pdf", mimeType: "application/pdf", buffer: troGros } },
      });
      expect(reponse.status()).toBe(400);
    });

    test("upload valide (MIME/taille/magic-bytes corrects) : stockage indisponible dans cet environnement -> 503, jamais une pièce orpheline en base", async ({ request }) => {
      const message = await creerMessage((await clientDemo()).id);
      const avant = await prisma.pieceJointe.count();
      const reponse = await request.post(`/api/client/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "valide.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(503);
      // La validation (avant stockage) a bien été franchie sans erreur — le
      // seul échec est le stockage lui-même, jamais une ligne PieceJointe
      // créée sans fichier réellement stocké.
      expect(await prisma.pieceJointe.count()).toBe(avant);
    });
  });
});

test.describe("V2.4 — Lot 2 : POST /api/clients/[id]/messages/[messageId]/pieces-jointes (upload Admin)", () => {
  test("non authentifié -> 403", async ({ request }) => {
    const client = await clientDemo();
    const message = await creerMessage(client.id);
    const reponse = await request.post(`/api/clients/${client.id}/messages/${message.id}/pieces-jointes`, {
      multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
    });
    expect(reponse.status()).toBe(403);
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });
    test("CLIENT -> 403 (cette route est réservée Admin)", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const reponse = await request.post(`/api/clients/${client.id}/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(403);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("INGENIEUR -> 403", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const reponse = await request.post(`/api/clients/${client.id}/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(403);
    });
  });

  test.describe("Admin", () => {
    test.use({ storageState: ADMIN_STATE });

    test("client inexistant -> 404", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const reponse = await request.post(`/api/clients/client-inexistant/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(404);
    });

    test("message n'appartenant pas au client de l'URL -> 404 (cohérence client/message revérifiée)", async ({ request }) => {
      const client = await clientDemo();
      const autreClient = await creerAutreClient();
      const messageDeLAutre = await creerMessage(autreClient.id);
      const reponse = await request.post(`/api/clients/${client.id}/messages/${messageDeLAutre.id}/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(404);
    });

    test("message inexistant -> 404", async ({ request }) => {
      const client = await clientDemo();
      const reponse = await request.post(`/api/clients/${client.id}/messages/message-inexistant/pieces-jointes`, {
        multipart: { fichier: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(404);
    });

    test("MIME hors allowlist -> 400", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const reponse = await request.post(`/api/clients/${client.id}/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "script.exe", mimeType: "application/x-executable", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(400);
    });

    test("upload valide : stockage indisponible dans cet environnement -> 503, jamais une pièce orpheline", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const avant = await prisma.pieceJointe.count();
      const reponse = await request.post(`/api/clients/${client.id}/messages/${message.id}/pieces-jointes`, {
        multipart: { fichier: { name: "valide.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
      });
      expect(reponse.status()).toBe(503);
      expect(await prisma.pieceJointe.count()).toBe(avant);
    });
  });
});

test.describe("V2.4 — Lot 3 : téléchargement sécurisé", () => {
  test.describe("Client — GET /api/client/messages/pieces-jointes/[id]/fichier", () => {
    test("non authentifié -> 403", async ({ request }) => {
      const reponse = await request.get(`/api/client/messages/pieces-jointes/inexistant/fichier`);
      expect(reponse.status()).toBe(403);
    });

    test.describe("Admin", () => {
      test.use({ storageState: ADMIN_STATE });
      test("ADMIN -> 403 (cette route est réservée Client)", async ({ request }) => {
        const reponse = await request.get(`/api/client/messages/pieces-jointes/inexistant/fichier`);
        expect(reponse.status()).toBe(403);
      });
    });

    test.describe("Ingénieur", () => {
      test.use({ storageState: INGENIEUR_STATE });
      test("INGENIEUR -> 403 (jamais d'accès aux pièces jointes Client)", async ({ request }) => {
        const reponse = await request.get(`/api/client/messages/pieces-jointes/inexistant/fichier`);
        expect(reponse.status()).toBe(403);
      });
    });

    test.describe("Client", () => {
      test.use({ storageState: CLIENT_STATE });

      test("IDOR : pièce jointe d'un message d'un autre client -> 404", async ({ request }) => {
        const autreClient = await creerAutreClient();
        const messageEtranger = await creerMessage(autreClient.id);
        const pieceEtrangere = await creerPieceDeTest(messageEtranger.id);
        const reponse = await request.get(`/api/client/messages/pieces-jointes/${pieceEtrangere.id}/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe inexistante -> 404", async ({ request }) => {
        const reponse = await request.get(`/api/client/messages/pieces-jointes/inexistant-xyz/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe supprimée logiquement -> 404 (jamais téléchargeable après suppression)", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id, { supprimeLe: new Date() });
        const reponse = await request.get(`/api/client/messages/pieces-jointes/${piece.id}/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe du client courant, stockage indisponible dans cet environnement -> 503, jamais un crash", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id);
        const reponse = await request.get(`/api/client/messages/pieces-jointes/${piece.id}/fichier`);
        expect(reponse.status()).toBe(503);
      });
    });
  });

  test.describe("Admin — GET /api/clients/[id]/messages/pieces-jointes/[pieceId]/fichier", () => {
    test.describe("Client", () => {
      test.use({ storageState: CLIENT_STATE });
      test("CLIENT -> 403 (cette route est réservée Admin)", async ({ request }) => {
        const client = await clientDemo();
        const reponse = await request.get(`/api/clients/${client.id}/messages/pieces-jointes/inexistant/fichier`);
        expect(reponse.status()).toBe(403);
      });
    });

    test.describe("Admin", () => {
      test.use({ storageState: ADMIN_STATE });

      test("client inexistant -> 404", async ({ request }) => {
        const reponse = await request.get(`/api/clients/client-inexistant/messages/pieces-jointes/inexistant/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe appartenant à un message d'un autre client que [id] -> 404", async ({ request }) => {
        const client = await clientDemo();
        const autreClient = await creerAutreClient();
        const messageDeLAutre = await creerMessage(autreClient.id);
        const pieceDeLAutre = await creerPieceDeTest(messageDeLAutre.id);
        const reponse = await request.get(`/api/clients/${client.id}/messages/pieces-jointes/${pieceDeLAutre.id}/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe supprimée logiquement -> 404", async ({ request }) => {
        const client = await clientDemo();
        const message = await creerMessage(client.id);
        const piece = await creerPieceDeTest(message.id, { supprimeLe: new Date() });
        const reponse = await request.get(`/api/clients/${client.id}/messages/pieces-jointes/${piece.id}/fichier`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe réelle du bon client, stockage indisponible -> 503", async ({ request }) => {
        const client = await clientDemo();
        const message = await creerMessage(client.id);
        const piece = await creerPieceDeTest(message.id);
        const reponse = await request.get(`/api/clients/${client.id}/messages/pieces-jointes/${piece.id}/fichier`);
        expect(reponse.status()).toBe(503);
      });
    });
  });
});

test.describe("V2.4 — Lot 4 : suppression logique", () => {
  test.describe("Client — DELETE /api/client/messages/pieces-jointes/[id]", () => {
    test("non authentifié -> 403", async ({ request }) => {
      const reponse = await request.delete(`/api/client/messages/pieces-jointes/inexistant`);
      expect(reponse.status()).toBe(403);
    });

    test.describe("Ingénieur", () => {
      test.use({ storageState: INGENIEUR_STATE });
      test("INGENIEUR -> 403", async ({ request }) => {
        const reponse = await request.delete(`/api/client/messages/pieces-jointes/inexistant`);
        expect(reponse.status()).toBe(403);
      });
    });

    test.describe("Client", () => {
      test.use({ storageState: CLIENT_STATE });

      test("IDOR : pièce jointe d'un autre client -> 404, jamais supprimée", async ({ request }) => {
        const autreClient = await creerAutreClient();
        const messageEtranger = await creerMessage(autreClient.id);
        const pieceEtrangere = await creerPieceDeTest(messageEtranger.id);
        const reponse = await request.delete(`/api/client/messages/pieces-jointes/${pieceEtrangere.id}`);
        expect(reponse.status()).toBe(404);

        const relue = await prisma.pieceJointe.findUnique({ where: { id: pieceEtrangere.id } });
        expect(relue!.supprimeLe).toBeNull();
      });

      test("suppression réussie -> 200, supprimeLe posé, jamais un DELETE physique (la ligne reste lisible en base)", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id);
        const reponse = await request.delete(`/api/client/messages/pieces-jointes/${piece.id}`);
        expect(reponse.status()).toBe(200);

        const relue = await prisma.pieceJointe.findUnique({ where: { id: piece.id } });
        expect(relue).not.toBeNull();
        expect(relue!.supprimeLe).not.toBeNull();
      });

      test("téléchargement impossible après suppression -> 404", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id);
        await request.delete(`/api/client/messages/pieces-jointes/${piece.id}`);
        const telechargement = await request.get(`/api/client/messages/pieces-jointes/${piece.id}/fichier`);
        expect(telechargement.status()).toBe(404);
      });

      test("idempotence : supprimer deux fois de suite renvoie 200 les deux fois, sans erreur", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id);
        const premiere = await request.delete(`/api/client/messages/pieces-jointes/${piece.id}`);
        expect(premiere.status()).toBe(200);
        const seconde = await request.delete(`/api/client/messages/pieces-jointes/${piece.id}`);
        expect(seconde.status()).toBe(200);
      });

      test("concurrence : deux suppressions simultanées de la même pièce ne créent jamais d'incohérence", async ({ request }) => {
        const message = await creerMessage((await clientDemo()).id);
        const piece = await creerPieceDeTest(message.id);
        const [r1, r2] = await Promise.all([
          request.delete(`/api/client/messages/pieces-jointes/${piece.id}`),
          request.delete(`/api/client/messages/pieces-jointes/${piece.id}`),
        ]);
        expect(r1.status()).toBe(200);
        expect(r2.status()).toBe(200);

        const relue = await prisma.pieceJointe.findUnique({ where: { id: piece.id } });
        expect(relue!.supprimeLe).not.toBeNull();
      });
    });
  });

  test.describe("Admin — DELETE /api/clients/[id]/messages/pieces-jointes/[pieceId]", () => {
    test.describe("Admin", () => {
      test.use({ storageState: ADMIN_STATE });

      test("client inexistant -> 404", async ({ request }) => {
        const reponse = await request.delete(`/api/clients/client-inexistant/messages/pieces-jointes/inexistant`);
        expect(reponse.status()).toBe(404);
      });

      test("pièce jointe d'un autre client que [id] -> 404", async ({ request }) => {
        const client = await clientDemo();
        const autreClient = await creerAutreClient();
        const messageDeLAutre = await creerMessage(autreClient.id);
        const pieceDeLAutre = await creerPieceDeTest(messageDeLAutre.id);
        const reponse = await request.delete(`/api/clients/${client.id}/messages/pieces-jointes/${pieceDeLAutre.id}`);
        expect(reponse.status()).toBe(404);
      });

      test("suppression réussie -> 200, supprimeLe posé", async ({ request }) => {
        const client = await clientDemo();
        const message = await creerMessage(client.id);
        const piece = await creerPieceDeTest(message.id);
        const reponse = await request.delete(`/api/clients/${client.id}/messages/pieces-jointes/${piece.id}`);
        expect(reponse.status()).toBe(200);
        const relue = await prisma.pieceJointe.findUnique({ where: { id: piece.id } });
        expect(relue!.supprimeLe).not.toBeNull();
      });
    });
  });
});

test.describe("V2.4 — listes de messages enrichies des pièces jointes (métadonnées uniquement)", () => {
  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });

    test("GET /api/client/messages inclut les pièces jointes actives du message, jamais fileUrl, jamais celles supprimées logiquement", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id);
      const pieceActive = await creerPieceDeTest(message.id);
      const pieceSupprimee = await creerPieceDeTest(message.id, { supprimeLe: new Date() });

      const reponse = await request.get("/api/client/messages");
      expect(reponse.ok()).toBeTruthy();
      const corps = await reponse.json();
      const messageRecu = corps.messages.find((m: { id: string }) => m.id === message.id);
      expect(messageRecu).toBeTruthy();
      expect(messageRecu.pieceJointes.length).toBe(1);
      expect(messageRecu.pieceJointes[0].id).toBe(pieceActive.id);
      expect(messageRecu.pieceJointes.some((p: { id: string }) => p.id === pieceSupprimee.id)).toBe(false);
      expect(messageRecu.pieceJointes[0].fileUrl).toBeUndefined();
    });
  });

  test.describe("Admin", () => {
    test.use({ storageState: ADMIN_STATE });

    test("GET /api/clients/[id]/messages inclut les pièces jointes actives, jamais fileUrl", async ({ request }) => {
      const client = await clientDemo();
      const message = await creerMessage(client.id, "ADMIN");
      const piece = await creerPieceDeTest(message.id);

      const reponse = await request.get(`/api/clients/${client.id}/messages`);
      expect(reponse.ok()).toBeTruthy();
      const corps = await reponse.json();
      const messageRecu = corps.messages.find((m: { id: string }) => m.id === message.id);
      expect(messageRecu.pieceJointes.length).toBe(1);
      expect(messageRecu.pieceJointes[0].id).toBe(piece.id);
      expect(messageRecu.pieceJointes[0].fileUrl).toBeUndefined();
    });
  });
});
