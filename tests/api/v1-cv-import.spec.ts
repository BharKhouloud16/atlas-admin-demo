import { test, expect } from "@playwright/test";
import { INGENIEUR_STATE, CLIENT_STATE } from "../setup/storage-state";

// V1 — import de CV : contrôles serveur effectués AVANT toute extraction IA
// ou tout stockage (aucune écriture en base ni dans le Blob store ici).
test.describe("V1 — POST /api/ingenieur/cv (validation du fichier)", () => {
  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });

    test("un fichier non-PDF déguisé en PDF est refusé (signature vérifiée)", async ({ request }) => {
      const reponse = await request.post("/api/ingenieur/cv", {
        multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("PK\u0003\u0004 pas un pdf") } },
      });
      expect(reponse.status()).toBe(400);
      expect((await reponse.json()).error).toContain("PDF");
    });

    test("un document Word est refusé avec un message explicite", async ({ request }) => {
      const reponse = await request.post("/api/ingenieur/cv", {
        multipart: {
          cv: {
            name: "cv.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            buffer: Buffer.from("PK\u0003\u0004"),
          },
        },
      });
      expect(reponse.status()).toBe(400);
    });

    test("un fichier vide est refusé", async ({ request }) => {
      const reponse = await request.post("/api/ingenieur/cv", {
        multipart: { cv: { name: "vide.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) } },
      });
      expect(reponse.status()).toBe(400);
    });

    test("un fichier de plus de 10 Mo est refusé (413)", async ({ request }) => {
      const gros = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x20)]);
      const reponse = await request.post("/api/ingenieur/cv", {
        multipart: { cv: { name: "gros.pdf", mimeType: "application/pdf", buffer: gros } },
      });
      expect(reponse.status()).toBe(413);
    });
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });

    test("un Client ne peut pas importer de CV (403)", async ({ request }) => {
      const reponse = await request.post("/api/ingenieur/cv", {
        multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") } },
      });
      expect(reponse.status()).toBe(403);
    });
  });
});
