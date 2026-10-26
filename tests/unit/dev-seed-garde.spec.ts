import { test, expect } from "@playwright/test";
import { devSeedDisponible } from "@/lib/dev-seed-garde";

// SÉCURITÉ — /api/dev-seed indisponible en Production Vercel (lib/dev-seed-garde.ts).
test.describe("Sécurité — garde de /api/dev-seed", () => {
  test("Production Vercel : jamais disponible", () => {
    expect(devSeedDisponible({ VERCEL_ENV: "production", SEED_TOKEN: "x" })).toBe(false);
  });

  test("CI / poste local (VERCEL_ENV absent) et Preview : inchangé (le jeton reste exigé par la route)", () => {
    expect(devSeedDisponible({})).toBe(true);
    expect(devSeedDisponible({ SEED_TOKEN: "x" })).toBe(true);
    expect(devSeedDisponible({ VERCEL_ENV: "preview" })).toBe(true);
  });
});
