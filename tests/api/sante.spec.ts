import { test, expect } from "@playwright/test";

// V1 — /api/sante : diagnostic de disponibilité de la base, en lecture seule,
// sans authentification et sans aucun secret dans la réponse.
test.describe("V1 — GET /api/sante", () => {
  test("répond 200 avec base=ok sur la base CI, sans exposer DATABASE_URL", async ({ request }) => {
    const reponse = await request.get("/api/sante");
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()["cache-control"]).toContain("no-store");
    const corps = await reponse.json();
    expect(corps.statut).toBe("ok");
    expect(corps.base).toBe("ok");
    expect(corps.cible.type).toBe("local");
    const brut = JSON.stringify(corps);
    expect(brut).not.toMatch(/postgres(ql)?:\/\//);
    expect(brut).not.toContain("atlas:atlas");
  });
});
