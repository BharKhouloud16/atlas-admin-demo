import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { cvIngenieurFictif } from "../fixtures/cv-fictif";

// Permissions entre rôles sur le parcours CV, et scénarios Admin associés.
// Stockage et extraction simulés en CI (lib/simulation-ci.ts) ; sessions
// signées directement (tests/setup/session-token.ts), sans connexion HTTP.
// Données fictives uniquement.

test.skip(process.env.ATLAS_SIMULATIONS_CI !== "oui", "Parcours CV : simulations CI requises (ATLAS_SIMULATIONS_CI=oui)");

async function ingenieur(suffixe: string) {
  const profil = await prisma.profil.create({ data: { nom: `Fictif ${suffixe}`, prenom: "Alex" } });
  const email = `cv-droits-${suffixe}@example.invalid`;
  await prisma.user.create({ data: { email, passwordHash: "inutilise", role: "INGENIEUR", actif: true, profilId: profil.id } });
  const contexte = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profilId: profil.id, email, contexte };
}

async function importerCv(contexte: APIRequestContext, pdf: Buffer) {
  return contexte.post("/api/ingenieur/cv", { multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: pdf } } });
}

const suffixe = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Parcours CV — permissions entre rôles", () => {
  test("seul un Ingénieur importe, consulte et finalise son CV (anonyme, Client, Admin : 403)", async ({ playwright }) => {
    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const pdf = cvIngenieurFictif(suffixe()).pdf;
    for (const contexte of [anonyme, client, admin]) {
      expect((await importerCv(contexte, pdf)).status()).toBe(403);
      expect((await contexte.get("/api/ingenieur/cv/infos")).status()).toBe(403);
      expect((await contexte.patch("/api/ingenieur/cv/infos", { data: { id: "x", valide: true } })).status()).toBe(403);
      expect((await contexte.post("/api/ingenieur/cv/finaliser")).status()).toBe(403);
    }
  });

  test("un Ingénieur ne lit ni ne modifie les informations CV d'un autre Ingénieur", async () => {
    const a = await ingenieur(suffixe());
    const b = await ingenieur(suffixe());
    const { pdf } = cvIngenieurFictif("a");
    expect((await importerCv(a.contexte, pdf)).status()).toBe(200);

    const infosB = await (await b.contexte.get("/api/ingenieur/cv/infos")).json();
    expect(infosB).toEqual([]);

    const infoA = await prisma.infoCV.findFirstOrThrow({ where: { profilId: a.profilId } });
    const tentative = await b.contexte.patch("/api/ingenieur/cv/infos", { data: { id: infoA.id, valeur: "modifié par B", valide: true } });
    expect(tentative.status()).toBe(404);
    const apres = await prisma.infoCV.findUniqueOrThrow({ where: { id: infoA.id } });
    expect(apres.valeur).toBe(infoA.valeur);
    expect(apres.valide).toBe(false);
  });

  test("fichier CV : un autre Ingénieur ou un Client ne peut pas lire celui d'un Ingénieur", async ({ playwright }) => {
    const a = await ingenieur(suffixe());
    const b = await ingenieur(suffixe());
    expect((await importerCv(a.contexte, cvIngenieurFictif("a").pdf)).status()).toBe(200);

    // ?profilId est ignoré pour un Ingénieur : B ne reçoit que son propre CV (aucun).
    expect((await b.contexte.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}`)).status()).toBe(404);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    expect((await client.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}`)).status()).toBe(403);
    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    expect((await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}&partage=jeton-forge`)).status()).toBe(403);
  });

  test("finalisation refusée tant que des informations restent à valider", async () => {
    const a = await ingenieur(suffixe());
    expect((await importerCv(a.contexte, cvIngenieurFictif("f").pdf)).status()).toBe(200);
    const refus = await a.contexte.post("/api/ingenieur/cv/finaliser");
    expect(refus.status()).toBe(400);
    expect((await prisma.profil.findUniqueOrThrow({ where: { id: a.profilId } })).cvValide).toBe(false);

    for (const info of await (await a.contexte.get("/api/ingenieur/cv/infos")).json()) {
      expect((await a.contexte.patch("/api/ingenieur/cv/infos", { data: { id: info.id, valide: true } })).status()).toBe(200);
    }
    expect((await a.contexte.post("/api/ingenieur/cv/finaliser")).status()).toBe(200);
    expect((await prisma.profil.findUniqueOrThrow({ where: { id: a.profilId } })).cvValide).toBe(true);
  });

  test("structuration du profil (Skill Graph) réservée à l'Admin", async () => {
    const a = await ingenieur(suffixe());
    expect((await importerCv(a.contexte, cvIngenieurFictif("s").pdf)).status()).toBe(200);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    for (const contexte of [a.contexte, client]) {
      expect((await contexte.post(`/api/profils/${a.profilId}/competences`)).status()).toBe(403);
    }
    expect(await prisma.profilCompetence.count({ where: { profilId: a.profilId } })).toBe(0);

    // Vérification d'une compétence : Admin uniquement, jamais l'Ingénieur lui-même.
    // (Seules les informations CV validées par l'Ingénieur alimentent le Skill Graph.)
    for (const info of await (await a.contexte.get("/api/ingenieur/cv/infos")).json()) {
      expect((await a.contexte.patch("/api/ingenieur/cv/infos", { data: { id: info.id, valide: true } })).status()).toBe(200);
    }
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    expect((await admin.post(`/api/profils/${a.profilId}/competences`)).status()).toBe(200);
    const competence = await prisma.profilCompetence.findFirstOrThrow({ where: { profilId: a.profilId } });
    for (const contexte of [a.contexte, client]) {
      expect((await contexte.patch(`/api/profils/${a.profilId}/competences/${competence.id}`, { data: { statut: "VERIFIE" } })).status()).toBe(403);
    }
    expect((await prisma.profilCompetence.findUniqueOrThrow({ where: { id: competence.id } })).statut).toBe("INFERE");
  });
});

test.describe("Parcours CV — scénarios Admin", () => {
  test("l'Admin consulte le CV importé d'un Ingénieur (fichier identique)", async () => {
    const a = await ingenieur(suffixe());
    const { pdf } = cvIngenieurFictif("adm");
    expect((await importerCv(a.contexte, pdf)).status()).toBe(200);
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const reponse = await admin.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}`);
    expect(reponse.status()).toBe(200);
    expect(Buffer.from(await reponse.body()).equals(pdf)).toBe(true);
  });

  test("lien de partage du CV : créé par l'Admin seulement, utilisable sans compte, limité à ce CV", async ({ playwright }) => {
    const a = await ingenieur(suffixe());
    const b = await ingenieur(suffixe());
    const { pdf } = cvIngenieurFictif("partage");
    expect((await importerCv(a.contexte, pdf)).status()).toBe(200);
    expect((await importerCv(b.contexte, cvIngenieurFictif("autre").pdf)).status()).toBe(200);

    expect((await a.contexte.post("/api/ingenieur/cv/lien-partage", { data: { profilId: a.profilId } })).status()).toBe(403);

    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const lien = await admin.post("/api/ingenieur/cv/lien-partage", { data: { profilId: a.profilId } });
    expect(lien.status()).toBe(200);
    const { url } = await lien.json();
    const partage = new URL(url).searchParams.get("partage")!;

    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    const lu = await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}&partage=${encodeURIComponent(partage)}`);
    expect(lu.status()).toBe(200);
    expect(Buffer.from(await lu.body()).equals(pdf)).toBe(true);
    // Le jeton du CV de A ne donne accès ni au CV de B, ni à la vidéo de A (hors périmètre V1, toujours refusée sans compte).
    expect((await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${b.profilId}&partage=${encodeURIComponent(partage)}`)).status()).toBe(403);
    expect((await anonyme.get(`/api/ingenieur/video/fichier?profilId=${a.profilId}&partage=${encodeURIComponent(partage)}`)).status()).toBe(403);
    // Sans jeton, ou avec un jeton forgé : toujours refusé.
    expect((await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}`)).status()).toBe(403);
    expect((await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}&partage=jeton-forge`)).status()).toBe(403);
    // Un lien de partage ne donne jamais accès aux versions archivées du CV (l'Admin, lui, y a accès).
    expect((await importerCv(a.contexte, cvIngenieurFictif("partage-v2").pdf)).status()).toBe(200);
    const version = await prisma.versionCv.findFirstOrThrow({ where: { profilId: a.profilId } });
    expect((await anonyme.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}&partage=${encodeURIComponent(partage)}&versionId=${version.id}`)).status()).toBe(403);
    const archive = await admin.get(`/api/ingenieur/cv/fichier?profilId=${a.profilId}&versionId=${version.id}`);
    expect(archive.status()).toBe(200);
    expect(Buffer.from(await archive.body()).equals(pdf)).toBe(true);
    // Le passage sans session n'ouvre aucune autre route /api/ingenieur.
    expect((await anonyme.get(`/api/ingenieur/cv/infos?partage=${encodeURIComponent(partage)}`)).status()).toBe(403);
  });
});
