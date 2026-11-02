import { test, expect } from "@playwright/test";
import {
  COMPTES_DEMO,
  COUT_BCRYPT,
  REFERENCE_PREVIEW_ATTENDUE,
  extraireReferenceSupabase,
  lireMotsDePasse,
  precontrolerComptes,
  verifierCiblePreview,
  type EtatCompte,
} from "@/lib/demo-reset";

// V1 — garde-fous du script scripts/reinitialiser-comptes-demo.ts.
// Aucun accès base : toutes les URL ci-dessous sont factices (mot de passe
// « x »), aucune ne permet de se connecter à quoi que ce soit.
const REF = REFERENCE_PREVIEW_ATTENDUE;
const REF_HISTORIQUE = "ccdefitelqxpnmnmwvqb";
const URL_POOLER_PREVIEW = `postgresql://postgres.${REF}:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
const URL_DIRECTE_PREVIEW = `postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres`;

test.describe("V1 — réinitialisation des comptes de démo : cible", () => {
  test("accepte la Preview (pooler et connexion directe) avec confirmation exacte", () => {
    for (const urlBase of [URL_POOLER_PREVIEW, URL_DIRECTE_PREVIEW]) {
      expect(verifierCiblePreview({ urlBase, confirmation: REF, vercelEnv: undefined })).toEqual({ ok: true });
    }
  });

  test("refuse sans confirmation, ou avec une confirmation différente", () => {
    expect(verifierCiblePreview({ urlBase: URL_POOLER_PREVIEW, confirmation: undefined, vercelEnv: undefined }).ok).toBe(false);
    expect(verifierCiblePreview({ urlBase: URL_POOLER_PREVIEW, confirmation: "", vercelEnv: undefined }).ok).toBe(false);
    expect(verifierCiblePreview({ urlBase: URL_POOLER_PREVIEW, confirmation: REF_HISTORIQUE, vercelEnv: undefined }).ok).toBe(false);
    expect(verifierCiblePreview({ urlBase: URL_POOLER_PREVIEW, confirmation: REF.toUpperCase(), vercelEnv: undefined }).ok).toBe(false);
  });

  test("refuse une base absente, invalide, locale ou d'un autre hébergeur", () => {
    for (const urlBase of [
      undefined,
      "",
      "pas une url",
      "postgresql://atlas:atlas@localhost:5432/atlas_ci",
      "postgresql://u:x@db.example.org:5432/x",
      "mysql://postgres.gvehwiukssyeydmerqyd:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    ]) {
      expect(verifierCiblePreview({ urlBase, confirmation: REF, vercelEnv: undefined }).ok, String(urlBase)).toBe(false);
    }
  });

  test("refuse la base historique (Production) même si la confirmation vise la Preview", () => {
    for (const urlBase of [
      `postgresql://postgres.${REF_HISTORIQUE}:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
      `postgresql://postgres:x@db.${REF_HISTORIQUE}.supabase.co:5432/postgres`,
    ]) {
      expect(verifierCiblePreview({ urlBase, confirmation: REF, vercelEnv: undefined }).ok).toBe(false);
    }
  });

  test("refuse un projet Supabase inconnu et une référence placée ailleurs que dans l'hôte/l'utilisateur", () => {
    const inconnu = "abcdefghijklmnopqrst";
    expect(
      verifierCiblePreview({
        urlBase: `postgresql://postgres.${inconnu}:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
        confirmation: REF,
        vercelEnv: undefined,
      }).ok
    ).toBe(false);
    // La référence Preview dans le nom de base ou en paramètre ne suffit pas.
    expect(
      verifierCiblePreview({
        urlBase: `postgresql://postgres.${inconnu}:x@aws-0-eu-central-1.pooler.supabase.com:6543/${REF}?app=${REF}`,
        confirmation: REF,
        vercelEnv: undefined,
      }).ok
    ).toBe(false);
    // Hôte imitant Supabase : refusé.
    expect(
      verifierCiblePreview({
        urlBase: `postgresql://postgres.${REF}:x@pooler.supabase.com.attaquant.example:6543/postgres`,
        confirmation: REF,
        vercelEnv: undefined,
      }).ok
    ).toBe(false);
  });

  test("refuse toujours quand VERCEL_ENV=production", () => {
    expect(verifierCiblePreview({ urlBase: URL_POOLER_PREVIEW, confirmation: REF, vercelEnv: "production" }).ok).toBe(false);
  });

  test("les messages de refus ne contiennent jamais l'URL ni le mot de passe", () => {
    const urlBase = `postgresql://postgres.${REF_HISTORIQUE}:SuperSecret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
    const r = verifierCiblePreview({ urlBase, confirmation: REF, vercelEnv: undefined });
    expect(r.ok).toBe(false);
    const raison = r.ok ? "" : r.raison;
    for (const fragment of ["SuperSecret", REF_HISTORIQUE, "pooler", "postgres"]) expect(raison).not.toContain(fragment);
  });

  test("extraireReferenceSupabase", () => {
    expect(extraireReferenceSupabase(URL_POOLER_PREVIEW)).toBe(REF);
    expect(extraireReferenceSupabase(URL_DIRECTE_PREVIEW)).toBe(REF);
    expect(extraireReferenceSupabase("postgresql://atlas:atlas@localhost:5432/x")).toBeNull();
    expect(extraireReferenceSupabase("n'importe quoi")).toBeNull();
  });
});

test.describe("V1 — réinitialisation des comptes de démo : mots de passe", () => {
  const complets = { DEMO_RESET_MDP_ADMIN: "MotDePasseA1", DEMO_RESET_MDP_CLIENT: "MotDePasseC1", DEMO_RESET_MDP_INGENIEUR: "MotDePasseI1" };

  test("accepte trois valeurs valides et les associe au bon compte", () => {
    const r = lireMotsDePasse(complets);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.motsDePasse.get("admin-demo@example.com")).toBe("MotDePasseA1");
      expect(r.motsDePasse.size).toBe(3);
    }
  });

  test("refuse une valeur absente, trop courte ou entourée d'espaces, sans jamais citer la valeur", () => {
    for (const [cle, valeur] of [
      ["DEMO_RESET_MDP_CLIENT", undefined],
      ["DEMO_RESET_MDP_ADMIN", "court"],
      ["DEMO_RESET_MDP_INGENIEUR", " AvecEspaces1 "],
    ] as const) {
      const r = lireMotsDePasse({ ...complets, [cle]: valeur });
      expect(r.ok, cle).toBe(false);
      if (!r.ok && valeur) expect(r.raison).not.toContain(valeur.trim());
    }
  });

  test("coût bcrypt identique à celui de l'application (12)", () => {
    expect(COUT_BCRYPT).toBe(12);
  });
});

test.describe("V1 — réinitialisation des comptes de démo : précontrôle", () => {
  const sains = (): EtatCompte[] =>
    COMPTES_DEMO.map((c, i) => ({
      id: `id-${i}`,
      email: c.email,
      role: c.role,
      actif: true,
      emailVerifie: true,
      desactive: false,
      totpActif: false,
    }));

  test("périmètre : exactement admin, client et ingénieur ; jamais le compte en attente", () => {
    expect(COMPTES_DEMO.map((c) => c.email)).toEqual([
      "admin-demo@example.com",
      "client-demo@example.com",
      "ingenieur-demo@example.com",
    ]);
  });

  test("accepte trois comptes sains", () => {
    expect(precontrolerComptes(sains())).toEqual({ ok: true });
  });

  test("refuse un compte manquant, un doublon, un mauvais rôle ou un compte hors périmètre", () => {
    expect(precontrolerComptes(sains().slice(1)).ok).toBe(false);
    expect(precontrolerComptes([...sains(), sains()[0]]).ok).toBe(false);
    const roleFaux = sains();
    roleFaux[1] = { ...roleFaux[1], role: "ADMIN" };
    expect(precontrolerComptes(roleFaux).ok).toBe(false);
    const horsPerimetre = [...sains(), { ...sains()[0], id: "x", email: "vrai-client@example.com" }];
    expect(precontrolerComptes(horsPerimetre).ok).toBe(false);
  });

  test("refuse un compte inactif, non confirmé, désactivé ou protégé par 2FA", () => {
    for (const champ of ["actif", "emailVerifie"] as const) {
      const l = sains();
      l[0] = { ...l[0], [champ]: false };
      expect(precontrolerComptes(l).ok, champ).toBe(false);
    }
    for (const champ of ["desactive", "totpActif"] as const) {
      const l = sains();
      l[2] = { ...l[2], [champ]: true };
      expect(precontrolerComptes(l).ok, champ).toBe(false);
    }
  });
});
