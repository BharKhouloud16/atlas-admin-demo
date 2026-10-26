import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// 2FA (TOTP) de l'Admin — app/api/auth/2fa/* et l'étape TOTP de
// /api/auth/login. Comptes Admin fictifs propres à chaque test.

const MDP = "Admin-2fa-Fictif-2026!";

async function adminFictif(suffixe: string, options: { secret?: string; codesSecours?: string[] } = {}) {
  const email = `admin-2fa-${suffixe}@example.invalid`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(MDP, 4),
      role: "ADMIN",
      actif: true,
      totpSecret: options.secret ?? null,
      totpActif: Boolean(options.secret),
      totpCodesSecours: options.codesSecours ? JSON.stringify(await Promise.all(options.codesSecours.map((c) => bcrypt.hash(c, 4)))) : null,
    },
  });
  return email;
}

test.describe("2FA Admin", () => {
  test("activation complète : QR, code de confirmation, connexion avec code TOTP puis code de secours à usage unique", async ({ playwright }) => {
    const email = await adminFictif(`${Date.now()}-activation`);
    const admin = await contexteConnecte({ email, role: "ADMIN" });

    const setup = await admin.post("/api/auth/2fa/setup");
    expect(setup.status()).toBe(200);
    const { secret } = await setup.json();
    expect((await admin.post("/api/auth/2fa/verifier", { data: { code: "000000" } })).status()).toBe(400);
    const verif = await admin.post("/api/auth/2fa/verifier", { data: { code: authenticator.generate(secret) } });
    expect(verif.status()).toBe(200);
    const { codesSecours } = await verif.json();
    expect(codesSecours).toHaveLength(8);
    // Les codes de secours ne sont jamais stockés en clair.
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).totpCodesSecours).not.toContain(codesSecours[0]);

    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    const sansCode = await anonyme.post("/api/auth/login", { data: { email, password: MDP } });
    expect(sansCode.status()).toBe(401);
    expect((await sansCode.json()).requiresTotp).toBe(true);
    expect((await anonyme.post("/api/auth/login", { data: { email, password: MDP, code: authenticator.generate(secret) } })).status()).toBe(200);
    expect((await anonyme.post("/api/auth/login", { data: { email, password: MDP, code: codesSecours[0] } })).status()).toBe(200);
    expect((await anonyme.post("/api/auth/login", { data: { email, password: MDP, code: codesSecours[0] } })).status()).toBe(401);
  });

  test("2FA active : une session seule ne peut ni remplacer le secret ni désactiver la protection", async () => {
    const secret = authenticator.generateSecret();
    const email = await adminFictif(`${Date.now()}-active`, { secret, codesSecours: ["secours-a"] });
    const sessionDerobee = await contexteConnecte({ email, role: "ADMIN" });

    const setup = await sessionDerobee.post("/api/auth/2fa/setup");
    expect(setup.status()).toBe(409);
    expect(await setup.text()).not.toContain(secret);
    expect((await sessionDerobee.post("/api/auth/2fa/desactiver", { data: { motDePasse: "mauvais" } })).status()).toBe(403);

    const compte = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(compte.totpActif).toBe(true);
    expect(compte.totpSecret).toBe(secret);

    // Avec le mot de passe, la désactivation reste possible.
    expect((await sessionDerobee.post("/api/auth/2fa/desactiver", { data: { motDePasse: MDP } })).status()).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).totpActif).toBe(false);
  });

  test("code de secours utilisé par deux connexions simultanées : une seule aboutit", async ({ playwright }) => {
    const email = await adminFictif(`${Date.now()}-concurrence`, { secret: authenticator.generateSecret(), codesSecours: ["secours-unique", "secours-autre"] });
    const base = process.env.BASE_URL ?? "http://localhost:3000";
    const [a, b] = await Promise.all([playwright.request.newContext({ baseURL: base }), playwright.request.newContext({ baseURL: base })]);
    const statuts = (await Promise.all([a, b].map((c) => c.post("/api/auth/login", { data: { email, password: MDP, code: "secours-unique" } })))).map((r) => r.status());
    expect(statuts.sort()).toEqual([200, 401]);
    const restants: string[] = JSON.parse((await prisma.user.findUniqueOrThrow({ where: { email } })).totpCodesSecours!);
    expect(restants).toHaveLength(1);
  });

  test("routes 2FA réservées à l'Admin connecté", async ({ playwright }) => {
    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    expect((await anonyme.post("/api/auth/2fa/setup")).status()).toBe(403);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    for (const route of ["setup", "verifier", "desactiver"]) {
      expect((await client.post(`/api/auth/2fa/${route}`, { data: {} })).status()).toBe(403);
    }
  });
});
