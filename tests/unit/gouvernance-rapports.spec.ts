import { test, expect } from "@playwright/test";
import {
  AGENTS_EMETTEURS,
  TYPES_RAPPORT,
  STATUTS_RAPPORT,
  plafonnerTexte,
} from "@/lib/gouvernance/rapports";

// COMPANY ATLAS — B18 : fonctions pures du registre de rapports
// (lib/gouvernance/rapports.ts). Aucun accès base de données ici — voir
// tests/api/b18-registre-rapports.spec.ts pour le chemin API complet.

test.describe("COMPANY ATLAS B18 — registre de rapports (fonctions pures)", () => {
  test("AGENTS_EMETTEURS contient exactement les 4 agents de l'architecture officielle, jamais un 5e", () => {
    expect(AGENTS_EMETTEURS).toEqual(["PRINCIPAL", "ATLAS_TALENT", "ATLAS_OS_SERVICES", "COMPANY_OS"]);
    expect(AGENTS_EMETTEURS.length).toBe(4);
  });

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
});
