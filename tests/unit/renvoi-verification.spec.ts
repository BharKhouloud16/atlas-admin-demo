import { test, expect } from "@playwright/test";
import { DELAI_MIN_RENVOI_MS, renvoiTropRecent, seuilExpirationRenvoi, VALIDITE_TOKEN_VERIFICATION_MS } from "@/lib/renvoi-verification";

// Délai minimal par compte entre deux liens de vérification (lib/renvoi-verification.ts).
test.describe("Renvoi de vérification — délai minimal par compte", () => {
  const maintenant = Date.UTC(2026, 9, 20, 12, 0, 0);
  const emisIlYa = (ms: number) => new Date(maintenant - ms + VALIDITE_TOKEN_VERIFICATION_MS);

  test("aucun lien antérieur : renvoi autorisé", () => {
    expect(renvoiTropRecent(null, maintenant)).toBe(false);
    expect(renvoiTropRecent(undefined, maintenant)).toBe(false);
  });

  test("lien émis il y a moins de 2 minutes : renvoi différé", () => {
    expect(renvoiTropRecent(emisIlYa(0), maintenant)).toBe(true);
    expect(renvoiTropRecent(emisIlYa(DELAI_MIN_RENVOI_MS - 1), maintenant)).toBe(true);
  });

  test("lien émis il y a 2 minutes ou plus, ou expiré : renvoi autorisé", () => {
    expect(renvoiTropRecent(emisIlYa(DELAI_MIN_RENVOI_MS), maintenant)).toBe(false);
    expect(renvoiTropRecent(emisIlYa(VALIDITE_TOKEN_VERIFICATION_MS + 1), maintenant)).toBe(false);
  });

  test("seuil de la mise à jour conditionnelle : strictement équivalent à renvoiTropRecent", () => {
    const seuil = seuilExpirationRenvoi(maintenant).getTime();
    for (const ecart of [-1, 0, 1, DELAI_MIN_RENVOI_MS]) {
      const expiration = new Date(seuil + ecart);
      // autorisé par la base <=> expiration <= seuil <=> pas « trop récent »
      expect(expiration.getTime() <= seuil, String(ecart)).toBe(!renvoiTropRecent(expiration, maintenant));
    }
  });
});
