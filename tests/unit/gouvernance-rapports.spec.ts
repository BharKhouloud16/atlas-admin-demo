import { test, expect } from "@playwright/test";
import { TYPES_RAPPORT, STATUTS_RAPPORT, plafonnerTexte } from "@/lib/gouvernance/rapports";
import * as rapportsModule from "@/lib/gouvernance/rapports";

// COMPANY ATLAS — B18-FIX : fonctions pures du registre de rapports
// (lib/gouvernance/rapports.ts), reconstruit sur AgentIdentity (B19)
// comme source unique de vérité. Aucun accès base de données ici — voir
// tests/api/b18-registre-rapports.spec.ts pour le chemin API complet.

test.describe("COMPANY ATLAS B18-FIX — registre de rapports (fonctions pures)", () => {
  test("TYPES_RAPPORT et STATUTS_RAPPORT restent des vocabulaires fermés, non vides", () => {
    expect(TYPES_RAPPORT.length).toBeGreaterThan(0);
    expect(STATUTS_RAPPORT).toEqual(["COMPLETE", "PARTIEL", "BLOQUE", "REFUSE"]);
  });

  test("plafonnerTexte laisse passer un texte court, tronque un texte trop long", () => {
    expect(plafonnerTexte(null)).toBeNull();
    expect(plafonnerTexte(undefined)).toBeNull();
    expect(plafonnerTexte("")).toBeNull();
    expect(plafonnerTexte("court")).toBe("court");

    const long = "x".repeat(5000);
    const plafonne = plafonnerTexte(long, 100);
    expect(plafonne?.length).toBe(100);
  });

  test("plafonnerTexte ignore une valeur du mauvais type plutôt que de planter (défense en profondeur)", () => {
    // @ts-expect-error — simulation volontaire d'une entrée mal typée (ex. JSON externe)
    expect(plafonnerTexte(12345)).toBeNull();
  });

  test("le module n'exporte plus AGENTS_EMETTEURS (B18-FIX : AgentIdentity est l'unique source de vérité, aucun second vocabulaire agent)", () => {
    expect("AGENTS_EMETTEURS" in rapportsModule).toBe(false);
  });
});
