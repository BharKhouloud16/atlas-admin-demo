import { test, expect } from "@playwright/test";
import { empreinteReference, identifierCibleBase } from "@/lib/db-target";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const build = require("../../lib/garde-base-build") as { empreinteSupabase(url?: string): string | null; verifierCibleBuildProduction(env: Record<string, string | undefined>): void };
import { EMPREINTES_INTERDITES_EN_PRODUCTION, estAbsenceMarqueur, refusCibleProduction, refusMarqueurProduction } from "@/lib/garde-base";

// Garde-fou Production / base Preview (lib/garde-base.ts). Références de
// projet fictives sauf celle d'atlas-preview, documentée (non secrète) dans
// docs/RESET_COMPTES_DEMO_PREVIEW.md.
const REF_PREVIEW = "gvehwiukssyeydmerqyd";
const REF_AUTRE = "abcdefghijklmnopqrst";
const direct = (ref: string) => `postgresql://postgres:x@db.${ref}.supabase.co:5432/postgres`;
const pooler = (ref: string) => `postgresql://postgres.${ref}:x@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;

test.describe("Garde-fou — Production ne peut pas utiliser la base Preview", () => {
  test("l'empreinte interdite est bien celle du projet atlas-preview", () => {
    expect(EMPREINTES_INTERDITES_EN_PRODUCTION).toContain(empreinteReference(REF_PREVIEW));
  });

  test("signal 1 : Production vers atlas-preview refusée, en connexion directe comme via le pooler", () => {
    for (const url of [direct(REF_PREVIEW), pooler(REF_PREVIEW)]) {
      expect(refusCibleProduction({ VERCEL_ENV: "production", DATABASE_URL: url })).toMatch(/base interdite/);
    }
  });

  test("signal 1 : le nom de la base n'intervient pas (même nom « postgres » accepté sur un autre projet)", () => {
    expect(refusCibleProduction({ VERCEL_ENV: "production", DATABASE_URL: direct(REF_AUTRE) })).toBeNull();
    expect(refusCibleProduction({ VERCEL_ENV: "production", DATABASE_URL: pooler(REF_AUTRE) })).toBeNull();
  });

  test("signal 1 : hors Production (Preview, CI, local), aucun refus", () => {
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      expect(refusCibleProduction({ VERCEL_ENV, DATABASE_URL: direct(REF_PREVIEW) })).toBeNull();
    }
  });

  test("signal 2 : marqueur « preview » refusé en Production, même si l'adresse n'est pas reconnue", () => {
    expect(refusMarqueurProduction({ VERCEL_ENV: "production" }, "preview")).toMatch(/marquée « preview »/);
    expect(refusMarqueurProduction({ VERCEL_ENV: "production" }, "PREVIEW ")).not.toBeNull();
    expect(refusMarqueurProduction({ VERCEL_ENV: "production" }, null)).toBeNull();
    expect(refusMarqueurProduction({ VERCEL_ENV: "production" }, "production")).toBeNull();
    expect(refusMarqueurProduction({ VERCEL_ENV: "preview" }, "preview")).toBeNull();
  });

  test("absence de marqueur reconnue (table ou schéma inexistant), autres erreurs non masquées", () => {
    expect(estAbsenceMarqueur({ code: "P2010", meta: { code: "42P01" } })).toBe(true);
    expect(estAbsenceMarqueur({ code: "3F000" })).toBe(true);
    expect(estAbsenceMarqueur({ message: 'relation "atlas_meta.environnement" does not exist' })).toBe(true);
    expect(estAbsenceMarqueur({ code: "P1001", message: "Can't reach database server" })).toBe(false);
  });

  test("contrôle au build : même empreinte que lib/db-target.ts, build Production refusé sur atlas-preview", () => {
    for (const url of [direct(REF_PREVIEW), pooler(REF_PREVIEW), direct(REF_AUTRE), pooler(REF_AUTRE), "postgresql://root@localhost/x", "pas une url"]) {
      const attendu = identifierCibleBase(url);
      expect(build.empreinteSupabase(url)).toBe(attendu.type === "supabase" ? attendu.empreinte : null);
    }
    expect(() => build.verifierCibleBuildProduction({ VERCEL_ENV: "production", DATABASE_URL: pooler(REF_PREVIEW) })).toThrow(/base Preview/);
    expect(() => build.verifierCibleBuildProduction({ VERCEL_ENV: "production", DATABASE_URL: direct(REF_AUTRE) })).not.toThrow();
    expect(() => build.verifierCibleBuildProduction({ VERCEL_ENV: "preview", DATABASE_URL: pooler(REF_PREVIEW) })).not.toThrow();
  });
});
