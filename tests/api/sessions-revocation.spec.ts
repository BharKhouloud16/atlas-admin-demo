import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// Révocation des sessions (User.sessionVersion, voir lib/auth.ts) : une
// session JWT n'est valide que si sa version est celle du compte en base.
// Changer ou réinitialiser le mot de passe incrémente la version et invalide
// toutes les autres sessions ouvertes ; supprimer le compte invalide toutes
// ses sessions. Un jeton sans version (émis avant la migration) reste valide
// tant que le compte n'a jamais révoqué ses sessions (version 0).

const MDP_INITIAL = "Initial-Revocation-2026!";

async function compteFictif(suffixe: string) {
  const email = `revocation-${suffixe}@example.invalid`;
  const profil = await prisma.profil.create({ data: { nom: `Revocation ${suffixe}`, prenom: "Fictif" } });
  await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(MDP_INITIAL, 4), role: "INGENIEUR", actif: true, profilId: profil.id },
  });
  return { email, profilId: profil.id };
}

// Route protégée sans effet de bord : un mauvais ancien mot de passe renvoie
// 400 si la session est acceptée, 401 si elle est refusée.
async function sessionAcceptee(contexte: APIRequestContext) {
  const r = await contexte.post("/api/auth/mot-de-passe", { data: { ancienMotDePasse: "faux-mot-de-passe", nouveauMotDePasse: "Inutilise-2026-xyz!", confirmationNouveauMotDePasse: "Inutilise-2026-xyz!" } });
  expect([400, 401]).toContain(r.status());
  return r.status() === 400;
}

test.describe("Sessions — révocation par version", () => {
  test("compte existant : un jeton émis avant la migration reste valide, et plusieurs sessions simultanées coexistent", async () => {
    const { email, profilId } = await compteFictif(`${Date.now()}-compat`);
    const appareil1 = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const appareil2 = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    expect(await sessionAcceptee(appareil1)).toBe(true);
    expect(await sessionAcceptee(appareil2)).toBe(true);
  });

  test("changement de mot de passe : la session courante reste ouverte, les autres sont révoquées", async () => {
    const { email, profilId } = await compteFictif(`${Date.now()}-change`);
    const courant = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const autre = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const nouveau = "Nouveau-Revocation-2026!";

    const r = await courant.post("/api/auth/mot-de-passe", { data: { ancienMotDePasse: MDP_INITIAL, nouveauMotDePasse: nouveau, confirmationNouveauMotDePasse: nouveau } });
    expect(r.status()).toBe(200);

    expect(await sessionAcceptee(courant)).toBe(true);
    expect(await sessionAcceptee(autre)).toBe(false);
    // Un jeton antérieur rejoué (même sans version) ne redevient jamais valide.
    expect(await sessionAcceptee(await contexteConnecte({ email, role: "INGENIEUR", profilId }))).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).sessionVersion).toBe(1);
  });

  test("réinitialisation par lien : toutes les sessions ouvertes sont révoquées", async ({ request }) => {
    const { email, profilId } = await compteFictif(`${Date.now()}-reset`);
    const ouverte = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    expect(await sessionAcceptee(ouverte)).toBe(true);

    const token = `jeton-revocation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await prisma.user.update({ where: { email }, data: { resetPasswordToken: token, resetPasswordExpire: new Date(Date.now() + 3600_000) } });
    const r = await request.post("/api/auth/reinitialiser-mot-de-passe", { data: { token, nouveauMotDePasse: "Reinitialise-Revocation-2026!", confirmationNouveauMotDePasse: "Reinitialise-Revocation-2026!" } });
    expect(r.status()).toBe(200);

    expect(await sessionAcceptee(ouverte)).toBe(false);
  });

  test("changements de mot de passe simultanés : un seul aboutit, aucune session antérieure ne survit", async () => {
    const { email, profilId } = await compteFictif(`${Date.now()}-concurrence`);
    const a = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const b = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const temoin = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const [ra, rb] = await Promise.all([
      a.post("/api/auth/mot-de-passe", { data: { ancienMotDePasse: MDP_INITIAL, nouveauMotDePasse: "Concurrent-A-2026-xyz!", confirmationNouveauMotDePasse: "Concurrent-A-2026-xyz!" } }),
      b.post("/api/auth/mot-de-passe", { data: { ancienMotDePasse: MDP_INITIAL, nouveauMotDePasse: "Concurrent-B-2026-xyz!", confirmationNouveauMotDePasse: "Concurrent-B-2026-xyz!" } }),
    ]);
    // Un seul changement aboutit ; l'autre, fondé sur un ancien mot de passe
    // déjà remplacé, est refusé (409, ou 400 s'il a lu le nouveau hash).
    const statuts = [ra.status(), rb.status()];
    expect(statuts.filter((x) => x === 200)).toHaveLength(1);
    expect([400, 409]).toContain(statuts.find((x) => x !== 200));
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).sessionVersion).toBe(1);
    expect(await sessionAcceptee(temoin)).toBe(false);
    // Seule la session qui a changé le mot de passe reste ouverte.
    const ouvertes = await Promise.all([a, b].map(sessionAcceptee));
    expect(ouvertes).toEqual([ra.status() === 200, rb.status() === 200]);
  });

  test("connexion après changement : la nouvelle session porte la version courante", async ({ playwright }) => {
    const { email, profilId } = await compteFictif(`${Date.now()}-login`);
    const courant = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const nouveau = "Apres-Change-Revocation-2026!";
    expect((await courant.post("/api/auth/mot-de-passe", { data: { ancienMotDePasse: MDP_INITIAL, nouveauMotDePasse: nouveau, confirmationNouveauMotDePasse: nouveau } })).status()).toBe(200);

    const navigateur = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    expect((await navigateur.post("/api/auth/login", { data: { email, password: MDP_INITIAL } })).status()).toBe(401);
    expect((await navigateur.post("/api/auth/login", { data: { email, password: nouveau } })).status()).toBe(200);
    expect(await sessionAcceptee(navigateur)).toBe(true);
  });

  test("compte supprimé : ses sessions ouvertes sur d'autres appareils sont refusées", async () => {
    const { email, profilId } = await compteFictif(`${Date.now()}-suppression`);
    const appareil1 = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const appareil2 = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    expect((await appareil1.delete("/api/ingenieur/compte")).status()).toBe(200);
    expect(await sessionAcceptee(appareil2)).toBe(false);
  });
});
