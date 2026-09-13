import { test, expect } from "@playwright/test";
import {
  STRATEGIC_CATEGORIES,
  STRATEGIC_PRIORITIES,
  STRATEGIC_PROPOSAL_STATUTS,
  estCorrelationIdValide,
  estStrategicCategoryValide,
  estStrategicPriorityValide,
  estStrategicProposalStatutValide,
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

  // B21.1 — M2 (correction, décision architecturale du 13/09/2026) :
  // correlationId est un identifiant de traçabilité, jamais un simple texte
  // métier — il n'est JAMAIS tronqué. estCorrelationIdValide est une pure
  // fonction de VALIDATION (jamais de transformation) : une valeur trop
  // longue doit être refusée (400) par l'appelant, jamais tronquée puis
  // acceptée. Voir tests/api/b21-strategic-foundation.spec.ts pour la
  // vérification bout en bout (300 → accepté tel quel, 301 → 400).
  test("estCorrelationIdValide accepte un correlationId de taille normale ou de exactement 300 caractères", () => {
    expect(estCorrelationIdValide("court")).toBe(true);
    expect(estCorrelationIdValide("b21-cycle-1700000000000-abc123def")).toBe(true);
    expect(estCorrelationIdValide("x".repeat(300))).toBe(true);
  });

  test("estCorrelationIdValide rejette tout correlationId de 301 caractères ou plus, sans jamais le modifier", () => {
    const valeur301 = "x".repeat(301);
    expect(estCorrelationIdValide(valeur301)).toBe(false);
    // Aucune troncature silencieuse : la fonction ne renvoie qu'un
    // booléen, elle ne peut structurellement pas altérer la valeur reçue.
    expect(valeur301.length).toBe(301);

    expect(estCorrelationIdValide("x".repeat(1000))).toBe(false);
  });
});
