import { test, expect } from "@playwright/test";
import {
  empreinteEmail,
  envoyerEmailReinitialisationMotDePasse,
  envoyerEmailTentativeInscriptionExistante,
  envoyerEmailVerificationAdresse,
  envoiEmailsOperationnel,
  masquerEmail,
  parcoursEmailIndisponible,
  resoudreBaseUrlApplication,
} from "@/lib/email";

// SÉCURITÉ — lib/email.ts : (1) aucun jeton ni lien ni adresse complète dans
// les journaux (mode placeholder, sans RESEND_API_KEY) ; (2) URL de base des
// liens propre à chaque environnement, sans repli vers la Production.

const JETON = "a".repeat(64);
const VARIABLES = ["EMAIL_APP_BASE_URL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "RESEND_API_KEY"] as const;
let sauvegarde: Record<string, string | undefined> = {};
test.beforeEach(() => {
  sauvegarde = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
});
test.afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

function espionnerJournaux() {
  const appels: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void appels.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void appels.push(a.map(String).join(" "));
  return { appels, restaurer: () => ((console.log = log), (console.error = error)) };
}

test.describe("Sécurité — journaux des emails", () => {
  test("masquerEmail / empreinteEmail : jamais l'adresse complète", () => {
    expect(masquerEmail("jeanne.dupont@example.com")).toBe("j***@example.com");
    expect(masquerEmail("invalide")).toBe("***");
    expect(empreinteEmail("Jeanne@Example.com")).toBe(empreinteEmail("jeanne@example.com"));
    expect(empreinteEmail("jeanne@example.com")).toMatch(/^[0-9a-f]{12}$/);
    expect(empreinteEmail("jeanne@example.com")).not.toBe(empreinteEmail("jean@example.com"));
  });

  test("vérification, réinitialisation, tentative d'inscription : aucun jeton, lien ni adresse dans les journaux", async () => {
    for (const v of VARIABLES) delete process.env[v];
    process.env.EMAIL_APP_BASE_URL = "https://exemple.test";
    const espion = espionnerJournaux();
    try {
      await envoyerEmailVerificationAdresse({ to: "jeanne@example.com", nom: "Jeanne", token: JETON });
      await envoyerEmailReinitialisationMotDePasse({ to: "jeanne@example.com", token: JETON });
      await envoyerEmailTentativeInscriptionExistante({ to: "jeanne@example.com" });
    } finally {
      espion.restaurer();
    }
    expect(espion.appels.length).toBe(3);
    for (const ligne of espion.appels) {
      expect(ligne).toContain("[email:placeholder]");
      expect(ligne).toContain(empreinteEmail("jeanne@example.com"));
      expect(ligne).not.toContain(JETON);
      expect(ligne).not.toContain("token");
      expect(ligne).not.toContain("http");
      expect(ligne).not.toContain("jeanne@example.com");
    }
  });

  test("URL de base inconnue : email à lien non envoyé, aucun repli vers la Production", async () => {
    for (const v of VARIABLES) delete process.env[v];
    const espion = espionnerJournaux();
    try {
      await envoyerEmailReinitialisationMotDePasse({ to: "jeanne@example.com", token: JETON });
    } finally {
      espion.restaurer();
    }
    expect(espion.appels.some((l) => l.includes("[email:placeholder]"))).toBe(false);
    expect(espion.appels.some((l) => l.includes("[email:non-envoye]"))).toBe(true);
    expect(espion.appels.join("\n")).not.toContain(JETON);
  });
});

test.describe("Sécurité — URL de base par environnement", () => {
  test("EMAIL_APP_BASE_URL prioritaire, réduite à son origine", () => {
    expect(resoudreBaseUrlApplication({ EMAIL_APP_BASE_URL: "https://app.exemple.test", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "prod.test" })).toBe(
      "https://app.exemple.test"
    );
    expect(resoudreBaseUrlApplication({ EMAIL_APP_BASE_URL: "https://app.exemple.test/" })).toBe("https://app.exemple.test");
  });

  test("Production : domaine de production du projet", () => {
    expect(resoudreBaseUrlApplication({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "atlas.exemple.test", VERCEL_URL: "deploiement-x.vercel.app" })).toBe(
      "https://atlas.exemple.test"
    );
  });

  test("Preview : URL de branche, sinon du déploiement — jamais la Production", () => {
    const base = { VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "atlas.exemple.test" };
    expect(resoudreBaseUrlApplication({ ...base, VERCEL_BRANCH_URL: "branche.vercel.app", VERCEL_URL: "deploiement.vercel.app" })).toBe("https://branche.vercel.app");
    expect(resoudreBaseUrlApplication({ ...base, VERCEL_URL: "deploiement.vercel.app" })).toBe("https://deploiement.vercel.app");
    expect(resoudreBaseUrlApplication(base)).toBeNull();
  });

  test("aucune variable, ou valeur dangereuse : null (fail-closed)", () => {
    expect(resoudreBaseUrlApplication({})).toBeNull();
    expect(resoudreBaseUrlApplication({ VERCEL_ENV: "development", VERCEL_URL: "x.vercel.app" })).toBeNull();
    for (const valeur of ["http://app.exemple.test", "https://app.exemple.test/chemin", "https://app.exemple.test?x=1", "https://u:p@app.exemple.test", "javascript:alert(1)", "pas une url"]) {
      expect(resoudreBaseUrlApplication({ EMAIL_APP_BASE_URL: valeur }), valeur).toBeNull();
    }
    expect(resoudreBaseUrlApplication({ EMAIL_APP_BASE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
});

test.describe("Disponibilité — envoi d'emails opérationnel ou non", () => {
  const prod = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "atlas.exemple.test" };
  test("opérationnel seulement avec RESEND_API_KEY ET une URL de base résolue", () => {
    expect(envoiEmailsOperationnel({ ...prod, RESEND_API_KEY: "re_test" })).toBe(true);
    expect(envoiEmailsOperationnel(prod)).toBe(false);
    expect(envoiEmailsOperationnel({ ...prod, RESEND_API_KEY: " " })).toBe(false);
    expect(envoiEmailsOperationnel({ RESEND_API_KEY: "re_test", VERCEL_ENV: "preview" })).toBe(false);
  });

  test("Vercel sans envoi opérationnel : parcours email indisponibles (503) ; hors Vercel : mode développement inchangé", () => {
    expect(parcoursEmailIndisponible(prod)).toBe(true);
    expect(parcoursEmailIndisponible({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app" })).toBe(true);
    expect(parcoursEmailIndisponible({ ...prod, RESEND_API_KEY: "re_test" })).toBe(false);
    expect(parcoursEmailIndisponible({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app", RESEND_API_KEY: "re_test" })).toBe(false);
    expect(parcoursEmailIndisponible({})).toBe(false);
    expect(parcoursEmailIndisponible({ ATLAS_LIENS_DEMO: "oui" })).toBe(false);
  });
});
