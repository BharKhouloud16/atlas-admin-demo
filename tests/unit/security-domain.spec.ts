import { test, expect } from "@playwright/test";
import {
  SECURITY_ASSET_TYPES,
  SECURITY_DOMAINS,
  SECURITY_FINDING_CONFIDENCES,
  estSecurityDomaineValide,
  estSecurityAssetTypeValide,
  estSecurityFindingConfidenceValide,
  estSecurityAssetReferenceValide,
  type SecurityAssetReference,
} from "@/lib/security/domain";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.1) — Domain Model.
// Tests purs (pas de DB, pas de réseau) sur lib/security/domain.ts. Ce lot
// ne contient aucun scanner, aucun scoring, aucun LLM : ces tests
// vérifient uniquement le vocabulaire fermé et les garde-fous de validité
// structurelle — jamais un verdict de vulnérabilité (voir
// tests/unit/quality-domain.spec.ts pour le même principe côté B12).

function referenceValide(overrides: Partial<SecurityAssetReference> = {}): SecurityAssetReference {
  return { type: "API", identifiant: "GET /api/quality", ...overrides };
}

test.describe("Security Domain Model (lib/security/domain)", () => {
  test("1. vocabulaire ASSET TYPE : exactement les neuf valeurs attendues, aucune de plus", () => {
    expect([...SECURITY_ASSET_TYPES].sort()).toEqual(
      ["APPLICATION", "API", "SERVICE", "DATABASE", "ENDPOINT", "COMPONENT", "DEPENDENCY", "CONFIGURATION", "DATA_STORE"].sort()
    );
  });

  test("2. vocabulaire SECURITY DOMAIN : exactement les treize domaines attendus, aucun de plus", () => {
    expect([...SECURITY_DOMAINS].sort()).toEqual(
      [
        "AUTHENTICATION",
        "AUTHORIZATION",
        "INPUT_VALIDATION",
        "CRYPTOGRAPHY",
        "SECRETS",
        "CONFIGURATION",
        "DEPENDENCIES",
        "DATA_PROTECTION",
        "API_SECURITY",
        "SESSION_SECURITY",
        "LOGGING",
        "INTEGRITY",
        "SUPPLY_CHAIN",
      ].sort()
    );
  });

  test("3. vocabulaire FINDING CONFIDENCE : exactement quatre valeurs, UNKNOWN inclus, aucune valeur 'confirmée par défaut'", () => {
    expect([...SECURITY_FINDING_CONFIDENCES].sort()).toEqual(["UNKNOWN", "OBSERVED", "SUSPECTED", "CONFIRMED"].sort());
  });

  test("4. estSecurityDomaineValide : accepte chaque valeur du vocabulaire fermé, rejette une valeur inventée", () => {
    for (const d of SECURITY_DOMAINS) {
      expect(estSecurityDomaineValide(d)).toBe(true);
    }
    expect(estSecurityDomaineValide("INVENTED_DOMAIN")).toBe(false);
    expect(estSecurityDomaineValide(undefined)).toBe(false);
    expect(estSecurityDomaineValide(123)).toBe(false);
  });

  test("5. estSecurityAssetTypeValide : accepte chaque valeur du vocabulaire fermé, rejette une valeur inventée", () => {
    for (const t of SECURITY_ASSET_TYPES) {
      expect(estSecurityAssetTypeValide(t)).toBe(true);
    }
    expect(estSecurityAssetTypeValide("INVENTED_ASSET")).toBe(false);
  });

  test("6. estSecurityFindingConfidenceValide : accepte chaque valeur du vocabulaire fermé, rejette une valeur inventée", () => {
    for (const c of SECURITY_FINDING_CONFIDENCES) {
      expect(estSecurityFindingConfidenceValide(c)).toBe(true);
    }
    expect(estSecurityFindingConfidenceValide("CERTAIN")).toBe(false);
  });

  test("7. référence d'actif valide : reconnue comme telle", () => {
    expect(estSecurityAssetReferenceValide(referenceValide())).toBe(true);
  });

  test("8. identifiant vide ou uniquement des espaces : jamais une référence valide, même avec un type correct", () => {
    expect(estSecurityAssetReferenceValide(referenceValide({ identifiant: "" }))).toBe(false);
    expect(estSecurityAssetReferenceValide(referenceValide({ identifiant: "   " }))).toBe(false);
  });

  test("9. type d'actif hors vocabulaire fermé : jamais accepté (cast forcé pour simuler une valeur corrompue)", () => {
    const corrompue = { ...referenceValide(), type: "SERVER" as unknown as SecurityAssetReference["type"] };
    expect(estSecurityAssetReferenceValide(corrompue)).toBe(false);
  });

  test("10. déterminisme : la même référence donne toujours le même verdict de validité", () => {
    const r = referenceValide();
    expect(estSecurityAssetReferenceValide(r)).toBe(estSecurityAssetReferenceValide({ ...r }));
  });

  test("11. aucune valeur du vocabulaire FINDING CONFIDENCE n'est un score numérique ou un pourcentage (vérification anti score-inventé)", () => {
    for (const c of SECURITY_FINDING_CONFIDENCES) {
      expect(typeof c).toBe("string");
      expect(c).not.toMatch(/^\d+$/);
      expect(c).not.toMatch(/%/);
    }
  });
});
