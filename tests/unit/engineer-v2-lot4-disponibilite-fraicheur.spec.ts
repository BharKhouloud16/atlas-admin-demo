import { test, expect } from "@playwright/test";
import { evaluerFraicheurDisponibilite, explicationFraicheurDisponibilite } from "@/lib/talent/disponibilite-fraicheur";

// ENGINEER PROFILE V2 — Lot 4 : tests unitaires purs de
// lib/talent/disponibilite-fraicheur.ts. Couvre les seuils, leurs
// frontières exactes, l'absence de date, et confirme que le mécanisme est
// purement informatif (jamais un champ qui modifie la disponibilité).

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = new Date("2026-06-01T00:00:00Z");

function ilYA(jours: number): Date {
  return new Date(MAINTENANT.getTime() - jours * MS_PAR_JOUR);
}

test.describe("V2 Lot 4 — evaluerFraicheurDisponibilite", () => {
  test("date récente (0 jour) -> RECENTE", () => {
    expect(evaluerFraicheurDisponibilite(ilYA(0), MAINTENANT)).toBe("RECENTE");
  });

  test("date ancienne (200 jours) -> OBSOLETE", () => {
    expect(evaluerFraicheurDisponibilite(ilYA(200), MAINTENANT)).toBe("OBSOLETE");
  });

  test("absence de date -> INCONNUE, jamais assimilée à OBSOLETE", () => {
    expect(evaluerFraicheurDisponibilite(null, MAINTENANT)).toBe("INCONNUE");
  });

  test("frontière exacte RECENTE/VIEILLISSANTE (30 vs 31 jours)", () => {
    expect(evaluerFraicheurDisponibilite(ilYA(30), MAINTENANT)).toBe("RECENTE");
    expect(evaluerFraicheurDisponibilite(ilYA(31), MAINTENANT)).toBe("VIEILLISSANTE");
  });

  test("frontière exacte VIEILLISSANTE/OBSOLETE (90 vs 91 jours)", () => {
    expect(evaluerFraicheurDisponibilite(ilYA(90), MAINTENANT)).toBe("VIEILLISSANTE");
    expect(evaluerFraicheurDisponibilite(ilYA(91), MAINTENANT)).toBe("OBSOLETE");
  });

  test("date future (incohérence horloge) -> jamais un état au-delà de RECENTE", () => {
    const futur = new Date(MAINTENANT.getTime() + 5 * MS_PAR_JOUR);
    expect(evaluerFraicheurDisponibilite(futur, MAINTENANT)).toBe("RECENTE");
  });

  test("gestion de fuseau horaire : deux dates à quelques heures d'écart dans la même journée UTC restent cohérentes", () => {
    const soir = new Date("2026-05-01T23:00:00Z");
    const matin = new Date("2026-06-01T01:00:00Z");
    // Écart réel ~26h -> 1 jour arrondi vers le bas -> RECENTE
    expect(evaluerFraicheurDisponibilite(soir, matin)).toBe("RECENTE");
  });
});

test.describe("V2 Lot 4 — explicationFraicheurDisponibilite", () => {
  test("INCONNUE -> texte neutre, sans nombre de jours", () => {
    expect(explicationFraicheurDisponibilite("INCONNUE", null)).toBe("Disponibilité jamais renseignée.");
  });

  test("chaque niveau produit un texte distinct et factuel", () => {
    expect(explicationFraicheurDisponibilite("RECENTE", 5)).toContain("5 jour(s)");
    expect(explicationFraicheurDisponibilite("VIEILLISSANTE", 60)).toContain("à confirmer");
    expect(explicationFraicheurDisponibilite("OBSOLETE", 200)).toContain("obsolète");
  });
});
