import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { synchroniserEtNotifierMessage } from "@/lib/message-attention-email";

// ATLAS LOT 15.1 — EMAIL PRODUCTION SAFETY CLEANUP (29/09/2026).
//
// lib/message-attention-email.ts calculait jusqu'ici sa base d'URL avec
// `process.env.EMAIL_APP_BASE_URL || "https://atlas-admin-demo.vercel.app"`
// — le seul fallback vers le domaine de démo encore actif après le
// durcissement de lib/email.ts en Lot 14.1. Ce fichier vérifie que la
// notification "message non lu" suit désormais exactement la même
// politique fail-closed : utilise EMAIL_APP_BASE_URL quand elle est
// correctement configurée, n'envoie rien sinon (jamais de lien fictif).
//
// Même méthode que tests/unit/email-url.spec.ts : RESEND_API_KEY n'est
// jamais configurée dans cet environnement de test/CI, donc toute tentative
// d'envoi passe par le chemin console.log("[email:placeholder] ...") de
// lib/email.ts — seul point observable sans mock supplémentaire.

function intercepterConsole() {
  const logsCaptures: string[] = [];
  const erreursCapturees: string[] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => {
    logsCaptures.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    erreursCapturees.push(args.map(String).join(" "));
  };
  return {
    logsCaptures,
    erreursCapturees,
    restaurer: () => {
      console.log = logOriginal;
      console.error = errorOriginal;
    },
  };
}

async function avecEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const originaux: Record<string, string | undefined> = {};
  for (const cle of Object.keys(vars)) originaux[cle] = process.env[cle];
  try {
    for (const [cle, valeur] of Object.entries(vars)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
    return await fn();
  } finally {
    for (const [cle, valeur] of Object.entries(originaux)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  }
}

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerClientAvecMessageEtAdmin() {
  const s = suffixe();
  const client = await prisma.client.create({ data: { nom: `Client Lot15.1 ${s}` } });
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const admin = await prisma.user.create({
    data: { email: `admin-lot151-${s}@test.local`, passwordHash, role: "ADMIN" },
  });
  await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Bonjour" } });
  return { client, admin };
}

test.describe("lib/message-attention-email.ts — Cas A : EMAIL_APP_BASE_URL configurée", () => {
  test("le lien utilise la base configurée, jamais atlas-admin-demo.vercel.app", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "https://atlas.example.com", RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } finally {
      console_.restaurer();
    }

    const tout = console_.logsCaptures.join("\n");
    expect(tout).toContain(admin.email);
    expect(tout).toContain("https://atlas.example.com/admin/clients/");
    expect(tout).not.toContain("atlas-admin-demo.vercel.app");
    expect(console_.erreursCapturees.join("\n")).not.toContain("EMAIL_APP_BASE_URL manquant");
  });
});

test.describe("lib/message-attention-email.ts — Cas B : EMAIL_APP_BASE_URL avec slash final", () => {
  test("aucun double slash dans le lien produit", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "https://atlas.example.com/", RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } finally {
      console_.restaurer();
    }

    const tout = console_.logsCaptures.join("\n");
    expect(tout).toContain(admin.email);
    expect(tout).not.toMatch(/atlas\.example\.com\/\/+/);
  });
});

test.describe("lib/message-attention-email.ts — Cas C : EMAIL_APP_BASE_URL absente (fail-closed)", () => {
  test("aucune notification envoyée, jamais un repli vers atlas-admin-demo.vercel.app", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: undefined, RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } finally {
      console_.restaurer();
    }

    expect(console_.logsCaptures.join("\n")).not.toContain("atlas-admin-demo.vercel.app");
    expect(console_.logsCaptures.some((a) => a.includes(admin.email))).toBe(false);
    expect(console_.erreursCapturees.some((e) => e.includes("EMAIL_APP_BASE_URL manquant"))).toBe(true);
  });
});

test.describe("lib/message-attention-email.ts — Cas D : EMAIL_APP_BASE_URL vide (même exigence que Cas C)", () => {
  test("aucune notification envoyée", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "", RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } finally {
      console_.restaurer();
    }

    expect(console_.logsCaptures.some((a) => a.includes(admin.email))).toBe(false);
    expect(console_.erreursCapturees.some((e) => e.includes("EMAIL_APP_BASE_URL manquant"))).toBe(true);
  });
});

test.describe("lib/message-attention-email.ts — Cas E : EMAIL_APP_BASE_URL whitespace-only (même exigence que Cas C)", () => {
  test("aucune notification envoyée", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "   ", RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } finally {
      console_.restaurer();
    }

    expect(console_.logsCaptures.some((a) => a.includes(admin.email))).toBe(false);
    expect(console_.erreursCapturees.some((e) => e.includes("EMAIL_APP_BASE_URL manquant"))).toBe(true);
  });
});

test.describe("lib/message-attention-email.ts — Cas F : absence de fuite et jamais de crash", () => {
  test("le message de configuration manquante ne contient ni email, ni clientId, ni RESEND_API_KEY", async () => {
    const { client, admin } = await creerClientAvecMessageEtAdmin();
    const console_ = intercepterConsole();
    let erreur: unknown = null;
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: undefined, RESEND_API_KEY: undefined }, async () => {
        await synchroniserEtNotifierMessage(client.id);
      });
    } catch (e) {
      erreur = e;
    } finally {
      console_.restaurer();
    }

    expect(erreur).toBeNull(); // best-effort : jamais un throw propagé au caller
    const erreurs = console_.erreursCapturees.join("\n");
    expect(erreurs).not.toContain(admin.email);
    expect(erreurs).not.toContain(client.id);
    expect(erreurs).not.toContain("RESEND_API_KEY");
    expect(erreurs).not.toMatch(/at\s+.*\.ts:\d+/); // pas de trace de stack
  });
});
