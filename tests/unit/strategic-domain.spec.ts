import { test, expect } from "@playwright/test";
import {
  STRATEGIC_CATEGORIES,
  STRATEGIC_PRIORITIES,
  STRATEGIC_PROPOSAL_STATUTS,
  estStrategicCategoryValide,
  estStrategicPriorityValide,
  estStrategicProposalStatutValide,
  plafonnerCorrelationId,
  plafonnerTexteStrategique,
} from "@/lib/strategic/domain";

// COMPANY ATLAS — B21 : fonctions pures de lib/strategic/domain.ts. Aucun
// accès base de données ici — voir tests/api/b21-strategic-foundation.spec.ts
// pour le chemin API complet.

test.describe("COMPANY ATLAS B21 — vocabulaires fermés (fonctions pures)", () => {
  test("STRATEGIC_CATEGORIES contient exactement les 11 catégories de la directive B21", () => {
    expect(STRATEGIC_CATEGORIES).toEqual([
      "MARKET",
      "COMPETITOR",
      "TECHNOLOGY",
      "CLIENT",
      "COMMERCIAL",
      "PRODUCT",
      "REGULATION",
      "SECURITY",
      "FINANCE",
      "OPERATIONS",
      "INNOVATION",
    ]);
  });

  test("STRATEGIC_PRIORITIES contient exactement les 4 priorités de la directive B21", () => {
    expect(STRATEGIC_PRIORITIES).toEqual(["P0_CRITICAL", "P1_STRATEGIC", "P2_IMPORTANT", "P3_MONITOR"]);
  });

  test("STRATEGIC_PROPOSAL_STATUTS reflète le cycle cible complet, dans l'ordre", () => {
    expect(STRATEGIC_PROPOSAL_STATUTS).toEqual([
      "PROPOSEE",
      "AUTORISATION_DEMANDEE",
      "AUTORISEE",
      "REFUSEE",
      "EXECUTEE",
      "CONTROLEE",
    ]);
  });

  test("estStrategicCategoryValide rejette toute valeur hors vocabulaire fermé", () => {
    expect(estStrategicCategoryValide("MARKET")).toBe(true);
    expect(estStrategicCategoryValide("ALL")).toBe(false);
    expect(estStrategicCategoryValide(null)).toBe(false);
    expect(estStrategicCategoryValide(undefined)).toBe(false);
    expect(estStrategicCategoryValide(42)).toBe(false);
  });

  test("estStrategicPriorityValide rejette toute valeur hors vocabulaire fermé", () => {
    expect(estStrategicPriorityValide("P0_CRITICAL")).toBe(true);
    expect(estStrategicPriorityValide("P4_LOW")).toBe(false);
  });

  test("estStrategicProposalStatutValide rejette toute valeur hors vocabulaire fermé", () => {
    expect(estStrategicProposalStatutValide("AUTORISEE")).toBe(true);
    expect(estStrategicProposalStatutValide("AUTO_AUTORISEE")).toBe(false);
  });

  test("plafonnerTexteStrategique laisse passer un texte court, tronque un texte trop long, rejette un mauvais type", () => {
    expect(plafonnerTexteStrategique(null)).toBeNull();
    expect(plafonnerTexteStrategique(undefined)).toBeNull();
    expect(plafonnerTexteStrategique("")).toBeNull();
    expect(plafonnerTexteStrategique("court")).toBe("court");

    const long = "x".repeat(5000);
    expect(plafonnerTexteStrategique(long, 100)?.length).toBe(100);

    // @ts-expect-error — simulation volontaire d'une entrée mal typée (ex. JSON externe)
    expect(plafonnerTexteStrategique(12345)).toBeNull();
  });

  // B21.1 — M2 : correlationId est TOUJOURS requis (jamais null en base),
  // donc plafonnerCorrelationId ne renvoie jamais null, contrairement à
  // plafonnerTexteStrategique — voir tests/api/b21-strategic-foundation.spec.ts
  // pour la vérification bout en bout (un correlationId trop long est
  // tronqué, jamais stocké intégralement, jamais un refus de la requête —
  // même comportement fonctionnel qu'avant B21.1).
  test("plafonnerCorrelationId laisse passer un correlationId de taille normale, tronque un correlationId anormalement long", () => {
    expect(plafonnerCorrelationId("court")).toBe("court");
    expect(plafonnerCorrelationId("b21-cycle-1700000000000-abc123def")).toBe("b21-cycle-1700000000000-abc123def");

    const long = "x".repeat(1000);
    const tronque = plafonnerCorrelationId(long);
    expect(tronque.length).toBe(300);
    expect(tronque).toBe(long.slice(0, 300));
  });
});
