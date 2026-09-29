import { test, expect } from "@playwright/test";
import {
  envoyerEmailVerificationAdresse,
  envoyerEmailReinitialisationMotDePasse,
  envoyerEmailCompteValide,
} from "@/lib/email";

// ATLAS LOT 14.1 — EMAIL PRODUCTION SAFETY HARDENING (29/09/2026).
//
// Avant ce lot, les 3 liens (vérification d'adresse, réinitialisation de
// mot de passe, connexion après validation de compte) étaient codés en dur
// vers https://atlas-admin-demo.vercel.app, sans jamais lire
// EMAIL_APP_BASE_URL — n'importe quel déploiement réel aurait envoyé des
// liens vers ce domaine de démonstration tiers dès RESEND_API_KEY
// configurée.
//
// Méthode de test : RESEND_API_KEY n'est configurée ni en local ni en CI
// pour ce dépôt (même limitation documentée dans tests/unit/cv-extraction.spec.ts
// pour ANTHROPIC_API_KEY) — envoyerEmail() prend donc systématiquement la
// voie "placeholder" (console.log du contenu complet, lien inclus) plutôt
// que d'appeler réellement Resend. On intercepte console.log/console.error
// pour observer le lien réellement construit, sans dépendre d'un
// fournisseur d'email externe.

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

test.describe("lib/email.ts — Cas A : EMAIL_APP_BASE_URL configurée", () => {
  test("les 3 liens utilisent la base configurée, jamais atlas-admin-demo.vercel.app", async () => {
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "https://atlas.example.com", RESEND_API_KEY: undefined }, async () => {
        await envoyerEmailVerificationAdresse({ to: "a@test.local", nom: "A", token: "tok-verif-1" });
        await envoyerEmailReinitialisationMotDePasse({ to: "a@test.local", token: "tok-reset-1" });
        await envoyerEmailCompteValide({ to: "a@test.local", nom: "A", role: "INGENIEUR" });
      });
    } finally {
      console_.restaurer();
    }

    const tout = console_.logsCaptures.join("\n");
    expect(tout).toContain("https://atlas.example.com/verifier-email?token=tok-verif-1");
    expect(tout).toContain("https://atlas.example.com/reinitialiser-mot-de-passe?token=tok-reset-1");
    expect(tout).toContain("https://atlas.example.com/connexion?role=ingenieur");
    expect(tout).not.toContain("atlas-admin-demo.vercel.app");
    expect(console_.erreursCapturees.join("\n")).not.toContain("EMAIL_APP_BASE_URL manquant");
  });
});

test.describe("lib/email.ts — Cas B : EMAIL_APP_BASE_URL avec slash final", () => {
  test("aucun double slash dans les URLs produites", async () => {
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "https://atlas.example.com/", RESEND_API_KEY: undefined }, async () => {
        await envoyerEmailVerificationAdresse({ to: "a@test.local", nom: "A", token: "tok-verif-2" });
        await envoyerEmailCompteValide({ to: "a@test.local", nom: "A", role: "CLIENT" });
      });
    } finally {
      console_.restaurer();
    }

    const tout = console_.logsCaptures.join("\n");
    expect(tout).toContain("https://atlas.example.com/verifier-email?token=tok-verif-2");
    expect(tout).toContain("https://atlas.example.com/connexion?role=client");
    expect(tout).not.toMatch(/atlas\.example\.com\/\/+/);
  });
});

test.describe("lib/email.ts — Cas C : EMAIL_APP_BASE_URL absente (fail-closed)", () => {
  test("aucun email n'est construit/envoyé, jamais un repli vers atlas-admin-demo.vercel.app", async () => {
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: undefined, RESEND_API_KEY: undefined }, async () => {
        await envoyerEmailVerificationAdresse({ to: "a@test.local", nom: "A", token: "tok-secret-verif" });
        await envoyerEmailReinitialisationMotDePasse({ to: "a@test.local", token: "tok-secret-reset" });
        await envoyerEmailCompteValide({ to: "a@test.local", nom: "A", role: "INGENIEUR" });
      });
    } finally {
      console_.restaurer();
    }

    // Aucun envoi placeholder n'a eu lieu pour ces 3 emails (fail-closed :
    // pas de lien du tout plutôt qu'un lien vers le domaine de démo).
    expect(console_.logsCaptures.join("\n")).not.toContain("atlas-admin-demo.vercel.app");
    expect(console_.logsCaptures.length).toBe(0);
    expect(console_.erreursCapturees.length).toBe(3);
    for (const erreur of console_.erreursCapturees) {
      expect(erreur).toContain("EMAIL_APP_BASE_URL manquant");
    }
  });
});

test.describe("lib/email.ts — Cas D : EMAIL_APP_BASE_URL whitespace-only (même exigence que Cas C)", () => {
  test("aucun email n'est construit/envoyé", async () => {
    const console_ = intercepterConsole();
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: "   ", RESEND_API_KEY: undefined }, async () => {
        await envoyerEmailVerificationAdresse({ to: "a@test.local", nom: "A", token: "tok-ws" });
      });
    } finally {
      console_.restaurer();
    }

    expect(console_.logsCaptures.length).toBe(0);
    expect(console_.erreursCapturees.length).toBe(1);
    expect(console_.erreursCapturees[0]).toContain("EMAIL_APP_BASE_URL manquant");
  });
});

test.describe("lib/email.ts — Cas E : absence de fuite", () => {
  test("le message de configuration manquante ne contient jamais le token, ni RESEND_API_KEY, ni aucun secret", async () => {
    const console_ = intercepterConsole();
    const tokenSecret = "ceci-est-un-token-tres-sensible-ne-doit-jamais-fuiter";
    try {
      await avecEnv({ EMAIL_APP_BASE_URL: undefined, RESEND_API_KEY: undefined }, async () => {
        await envoyerEmailReinitialisationMotDePasse({ to: "a@test.local", token: tokenSecret });
      });
    } finally {
      console_.restaurer();
    }

    const erreurs = console_.erreursCapturees.join("\n");
    expect(erreurs).not.toContain(tokenSecret);
    expect(erreurs).not.toContain("RESEND_API_KEY");
    expect(erreurs).not.toMatch(/at\s+.*\.ts:\d+/); // pas de trace de stack
  });
});
