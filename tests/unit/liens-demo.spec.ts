import { test, expect } from "@playwright/test";
import { avecLienDemo, liensDemoAutorises, VARIABLE_LIENS_DEMO } from "@/lib/liens-demo";

// SÉCURITÉ — non-régression de la faille « lien de réinitialisation renvoyé
// dans la réponse HTTP » (voir lib/liens-demo.ts). Fonctions pures, sans base.
test.describe("Sécurité — liens démo désactivés par défaut", () => {
  test("variable absente : jamais de lien", () => {
    expect(liensDemoAutorises({})).toBe(false);
  });

  test("variable désactivée ou valeur non exacte : jamais de lien", () => {
    for (const valeur of ["", "non", "false", "0", "true", "1", "OUI", " oui", "oui "]) {
      expect(liensDemoAutorises({ [VARIABLE_LIENS_DEMO]: valeur }), JSON.stringify(valeur)).toBe(false);
    }
  });

  test("Vercel Preview ou Production : jamais de lien, même si la variable vaut « oui »", () => {
    for (const vercelEnv of ["preview", "production", "development"]) {
      expect(liensDemoAutorises({ [VARIABLE_LIENS_DEMO]: "oui", VERCEL_ENV: vercelEnv }), vercelEnv).toBe(false);
    }
  });

  test("la présence ou l'absence d'un fournisseur d'email ne suffit jamais à activer les liens", () => {
    expect(liensDemoAutorises({ RESEND_API_KEY: undefined })).toBe(false);
    expect(liensDemoAutorises({ RESEND_API_KEY: "" })).toBe(false);
  });

  test("activation explicite hors Vercel (CI / poste local) : lien autorisé", () => {
    expect(liensDemoAutorises({ [VARIABLE_LIENS_DEMO]: "oui" })).toBe(true);
  });

  test("avecLienDemo : corps inchangé (aucune clé ajoutée) sans autorisation", () => {
    const corps = { ok: true, message: "Si un compte existe…" };
    const resultat = avecLienDemo(corps, "lienReinitialisationDemo", "/reinitialiser-mot-de-passe?token=abc", {});
    expect(resultat).toEqual(corps);
    expect(Object.keys(resultat)).toEqual(["ok", "message"]);
    expect(JSON.stringify(resultat)).not.toContain("token");
  });

  test("avecLienDemo : lien ajouté uniquement avec autorisation explicite", () => {
    const resultat = avecLienDemo({ ok: true }, "lienVerificationDemo", "/verifier-email?token=abc", { [VARIABLE_LIENS_DEMO]: "oui" });
    expect(resultat).toEqual({ ok: true, lienVerificationDemo: "/verifier-email?token=abc" });
  });
});
