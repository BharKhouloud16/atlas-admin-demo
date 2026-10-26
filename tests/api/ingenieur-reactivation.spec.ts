import { test, expect, request as pwRequest } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// POST /api/ingenieur/compte/reactiver — contrôles d'accès (intégration HTTP,
// sans navigateur). La session est signée directement (voir
// tests/setup/session-token.ts) pour ne pas consommer le quota de connexions.
const URL_REACTIVER = "/api/ingenieur/compte/reactiver";

async function ingenieurDesactive() {
  const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const profil = await prisma.profil.create({ data: { nom: `Reactivation API ${suffixe}` } });
  const email = `reactivation-api-${suffixe}@example.com`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("inutile-ici", 4),
      role: "INGENIEUR",
      actif: true,
      profilId: profil.id,
      desactive: true,
      desactiveLe: new Date(),
    },
  });
  return { email, profilId: profil.id };
}

test.describe("POST /api/ingenieur/compte/reactiver", () => {
  test("sans session : refusé, aucun compte modifié", async ({ request }) => {
    const reponse = await request.post(URL_REACTIVER);
    expect(reponse.status()).toBe(403);
  });

  test("session invalide (jeton non signé par le serveur) : refusé", async ({ baseURL }) => {
    const contexte = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: "atlas_session=jeton.falsifie.invalide" },
    });
    const reponse = await contexte.post(URL_REACTIVER);
    expect(reponse.status()).toBe(403);
    await contexte.dispose();
  });

  test("session Client ou Admin : refusée, l'ingénieur reste désactivé", async () => {
    const { profilId } = await ingenieurDesactive();
    for (const role of ["CLIENT", "ADMIN"] as const) {
      const contexte = await contexteConnecte({ email: `intrus-${role.toLowerCase()}@example.com`, role, profilId });
      const reponse = await contexte.post(URL_REACTIVER);
      expect(reponse.status(), role).toBe(403);
      await contexte.dispose();
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { profilId } })).desactive).toBe(true);
  });

  test("ingénieur désactivé : réactive uniquement son propre compte", async () => {
    const cible = await ingenieurDesactive();
    const autre = await ingenieurDesactive();
    const contexte = await contexteConnecte({ email: cible.email, role: "INGENIEUR", profilId: cible.profilId, desactive: true });

    const reponse = await contexte.post(URL_REACTIVER);
    expect(reponse.status()).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    await contexte.dispose();

    const apres = await prisma.user.findUniqueOrThrow({ where: { profilId: cible.profilId } });
    expect(apres.desactive).toBe(false);
    expect(apres.desactiveLe).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { profilId: autre.profilId } })).desactive).toBe(true);
  });

  test("une requête GET n'est pas acceptée", async () => {
    const { email, profilId } = await ingenieurDesactive();
    const contexte = await contexteConnecte({ email, role: "INGENIEUR", profilId, desactive: true });
    const reponse = await contexte.get(URL_REACTIVER);
    expect(reponse.status()).toBe(405);
    await contexte.dispose();
    expect((await prisma.user.findUniqueOrThrow({ where: { profilId } })).desactive).toBe(true);
  });
});
