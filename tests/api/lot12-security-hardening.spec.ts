import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS LOT 12.1 — SECURITY HARDENING (29/09/2026).
//
// Couvre les 2 correctifs d'exposition d'erreur (app/api/ingenieur/cv et
// app/api/ingenieur/video) et le nouveau healthcheck (app/api/health).
//
// BLOB_READ_WRITE_TOKEN n'est configuré ni en local ni en CI (même
// limitation documentée dans tests/api/v24-piece-jointe.spec.ts et
// tests/api/b44-engineer-profile-v1.spec.ts) : uploaderFichier() échoue donc
// systématiquement et réellement dans cet environnement, avec un message
// interne explicite ("BLOB_READ_WRITE_TOKEN manquant... tableau de bord
// Vercel") — exactement le type de détail interne qui ne doit jamais
// atteindre le client. Ce comportement d'environnement, plutôt qu'un mock,
// est utilisé ici pour prouver le correctif sur le vrai chemin d'échec.
const PDF_VALIDE = Buffer.from("%PDF-1.4\n%test-content\n");

async function nouvelIngenieur(suffixe: string) {
  const profil = await prisma.profil.create({ data: { nom: `SEC121-${suffixe}`, prenom: "Test" } });
  const email = `ingenieur-sec121-${suffixe}-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profil.id, emailVerifie: true },
  });
  const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profil, ctx };
}

test.describe("Lot 12.1 — CV/vidéo : aucune erreur interne exposée au client", () => {
  test("1. échec d'upload CV (BLOB_READ_WRITE_TOKEN absent) -> message générique, jamais le détail interne", async () => {
    const { ctx } = await nouvelIngenieur("cv");
    const reponse = await ctx.post("/api/ingenieur/cv", {
      multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_VALIDE } },
    });
    expect(reponse.status()).toBe(500);
    const corps = await reponse.json();
    expect(corps.error).toBe("Échec de l'upload du CV. Veuillez réessayer.");
    expect(corps.error).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(corps.error).not.toContain("Vercel");
    expect(JSON.stringify(corps)).not.toContain("BLOB_READ_WRITE_TOKEN");

    await ctx.dispose();
  });

  test("2. échec d'upload vidéo (BLOB_READ_WRITE_TOKEN absent) -> message générique, jamais le détail interne", async () => {
    const { ctx } = await nouvelIngenieur("video");
    const reponse = await ctx.post("/api/ingenieur/video", {
      multipart: { video: { name: "presentation.mp4", mimeType: "video/mp4", buffer: Buffer.from("fake-video-bytes") } },
    });
    expect(reponse.status()).toBe(500);
    const corps = await reponse.json();
    expect(corps.error).toBe("Échec de l'upload de la vidéo. Veuillez réessayer.");
    expect(corps.error).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(corps.error).not.toContain("Vercel");
    expect(JSON.stringify(corps)).not.toContain("BLOB_READ_WRITE_TOKEN");

    await ctx.dispose();
  });
});

test.describe("Lot 12.1 — GET /api/health", () => {
  test("3. répond 200 avec un état simple, aucune donnée sensible", async ({ request }) => {
    const reponse = await request.get("/api/health");
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();
    expect(corps.status).toBe("ok");

    const texteBrut = JSON.stringify(corps).toLowerCase();
    for (const motInterdit of ["database_url", "secret", "token", "password", "postgres", "prisma"]) {
      expect(texteBrut).not.toContain(motInterdit);
    }
  });

  test("4. accessible sans authentification (l'infrastructure ne fournit pas de session)", async ({ request }) => {
    const reponse = await request.get("/api/health");
    expect(reponse.status()).not.toBe(403);
    expect(reponse.status()).toBe(200);
  });
});
