import { test, expect } from "@playwright/test";
import { estIndisponibiliteBase, resumeErreurJournalisable } from "@/lib/db-errors";

// V1 — non-régression de l'incident « PrismaClientInitializationError /
// FATAL: (ENOTFOUND: tenant/user postgres.… not found) » : une base
// injoignable doit être reconnue comme indisponibilité (→ 503 contrôlé côté
// route), jamais confondue avec une erreur métier, et le résumé journalisé ne
// doit jamais contenir le message brut (hôte, utilisateur de connexion…).

function erreurInitialisation(message: string) {
  const e = new Error(message) as Error & { errorCode?: string };
  e.name = "PrismaClientInitializationError";
  return e;
}

function erreurRequete(code: string) {
  const e = new Error(`erreur ${code}`) as Error & { code?: string };
  e.name = "PrismaClientKnownRequestError";
  e.code = code;
  return e;
}

test.describe("V1 — détection d'indisponibilité de la base (lib/db-errors.ts)", () => {
  test("PrismaClientInitializationError (tenant/user not found) est une indisponibilité", () => {
    const e = erreurInitialisation("FATAL: (ENOTFOUND: tenant/user postgres.xxxxxxxx not found)");
    expect(estIndisponibiliteBase(e)).toBe(true);
  });

  test("les codes de connexion Prisma (P1001, P1017, P2024…) sont des indisponibilités", () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017", "P2024"]) {
      expect(estIndisponibiliteBase(erreurRequete(code))).toBe(true);
    }
  });

  test("une erreur métier Prisma (P2002, P2025) n'est PAS une indisponibilité", () => {
    expect(estIndisponibiliteBase(erreurRequete("P2002"))).toBe(false);
    expect(estIndisponibiliteBase(erreurRequete("P2025"))).toBe(false);
  });

  test("valeurs quelconques : jamais une indisponibilité", () => {
    expect(estIndisponibiliteBase(new Error("boom"))).toBe(false);
    expect(estIndisponibiliteBase(null)).toBe(false);
    expect(estIndisponibiliteBase(undefined)).toBe(false);
    expect(estIndisponibiliteBase("P1001")).toBe(false);
  });

  test("le résumé journalisable ne contient que le type et le code, jamais le message", () => {
    const e = erreurInitialisation("Can't reach database server at db.secret-host.example:5432 user=admin");
    const resume = resumeErreurJournalisable(e);
    expect(resume).toBe("PrismaClientInitializationError");
    expect(resume).not.toContain("secret-host");
    expect(resumeErreurJournalisable(erreurRequete("P1001"))).toBe("PrismaClientKnownRequestError(P1001)");
  });
});
