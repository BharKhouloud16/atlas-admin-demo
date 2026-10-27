import { test, expect } from "@playwright/test";
import { deriverStatutAutorisationStrategique } from "@/lib/strategic/authorization-status";

// COMPANY ATLAS — B24 Lot C2 (14/09/2026) : fonction PURE
// deriverStatutAutorisationStrategique (lib/strategic/authorization-status.ts).
// Aucun accès base de données ici — vérifie uniquement la projection
// PENDING/APPROVED/REJECTED/EXPIRED/REVOKED/NO_AUTHORIZATION/UNKNOWN depuis
// une AuthorizationRequest B22 (status + decision + expiresAt) déjà
// résolue, sans jamais toucher StrategicAuthorization (legacy) ni
// StrategicActionProposal.statut. La couverture API (lecture réelle via
// StrategicAuthorizationLink + AuthorizationRequest, RBAC, non-mutation)
// est dans tests/api/b24-lot-c2-read-derived-status.spec.ts.

const DANS_LE_FUTUR = new Date(Date.now() + 72 * 60 * 60 * 1000);
const DANS_LE_PASSE = new Date(Date.now() - 60 * 1000);

test.describe("COMPANY ATLAS B24 Lot C2 — deriverStatutAutorisationStrategique (fonction pure)", () => {
  test("aucune demande (null) -> NO_AUTHORIZATION, tous les champs détaillés à null", () => {
    const resultat = deriverStatutAutorisationStrategique(null);
    expect(resultat).toEqual({
      statut: "NO_AUTHORIZATION",
      authorizationRequestId: null,
      requestStatus: null,
      decision: null,
      expiresAt: null,
    });
  });

  test("status PENDING, non expirée -> PENDING (même si decision porte le placeholder APPROVAL_REQUIRED)", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-1",
      status: "PENDING",
      decision: "APPROVAL_REQUIRED",
      expiresAt: DANS_LE_FUTUR,
    });
    expect(resultat.statut).toBe("PENDING");
    expect(resultat.authorizationRequestId).toBe("req-1");
    expect(resultat.requestStatus).toBe("PENDING");
    expect(resultat.decision).toBe("APPROVAL_REQUIRED");
  });

  test("status RESOLVED + decision ALLOW -> APPROVED", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-2",
      status: "RESOLVED",
      decision: "ALLOW",
      expiresAt: DANS_LE_FUTUR,
    });
    expect(resultat.statut).toBe("APPROVED");
  });

  test("status RESOLVED + decision DENY -> REJECTED (jamais transformé en EXPIRED ni fusionné avec un autre statut)", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-3",
      status: "RESOLVED",
      decision: "DENY",
      expiresAt: DANS_LE_FUTUR,
    });
    expect(resultat.statut).toBe("REJECTED");
  });

  test("status EXPIRED (déjà persisté par B22) -> EXPIRED, jamais retraduit en REJECTED", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-4",
      status: "EXPIRED",
      decision: "APPROVAL_REQUIRED",
      expiresAt: DANS_LE_PASSE,
    });
    expect(resultat.statut).toBe("EXPIRED");
  });

  test("status REVOKED -> REVOKED, jamais retraduit en REJECTED", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-5",
      status: "REVOKED",
      decision: "APPROVAL_REQUIRED",
      expiresAt: DANS_LE_FUTUR,
    });
    expect(resultat.statut).toBe("REVOKED");
  });

  test("IMPORTANT — status encore PENDING en base mais expiresAt déjà dépassé -> EXPIRED (reflète en lecture seule le même fait que B22 constaterait paresseusement, sans écriture ni nouveau mécanisme d'expiration)", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-6",
      status: "PENDING",
      decision: "APPROVAL_REQUIRED",
      expiresAt: DANS_LE_PASSE,
    });
    expect(resultat.statut).toBe("EXPIRED");
    // Le detail brut B22 reste honnête : requestStatus rapporte toujours la
    // valeur RÉELLEMENT en base (PENDING), jamais falsifiée — seule la
    // projection `statut` reflète l'expiration.
    expect(resultat.requestStatus).toBe("PENDING");
  });

  test("REVOKED reste REVOKED même si expiresAt est déjà dépassé (l'expiration ne prime jamais sur une révocation déjà actée)", () => {
    const resultat = deriverStatutAutorisationStrategique({
      id: "req-7",
      status: "REVOKED",
      decision: "APPROVAL_REQUIRED",
      expiresAt: DANS_LE_PASSE,
    });
    expect(resultat.statut).toBe("REVOKED");
  });

  test("défensif — RESOLVED avec une decision que le code B22 actuel ne produit jamais dans cet état (APPROVAL_REQUIRED/RESTRICT/null) -> UNKNOWN, jamais un statut inventé silencieusement", () => {
    expect(
      deriverStatutAutorisationStrategique({ id: "req-8", status: "RESOLVED", decision: "APPROVAL_REQUIRED", expiresAt: DANS_LE_FUTUR }).statut
    ).toBe("UNKNOWN");
    expect(
      deriverStatutAutorisationStrategique({ id: "req-9", status: "RESOLVED", decision: "RESTRICT", expiresAt: DANS_LE_FUTUR }).statut
    ).toBe("UNKNOWN");
    expect(
      deriverStatutAutorisationStrategique({ id: "req-10", status: "RESOLVED", decision: null, expiresAt: DANS_LE_FUTUR }).statut
    ).toBe("UNKNOWN");
  });

  test("absence de mutation / déterminisme : deux appels avec le même input produisent EXACTEMENT le même résultat", () => {
    const entree = { id: "req-11", status: "RESOLVED" as const, decision: "ALLOW" as const, expiresAt: DANS_LE_FUTUR };
    const premier = deriverStatutAutorisationStrategique(entree);
    const second = deriverStatutAutorisationStrategique(entree);
    expect(premier).toEqual(second);
  });
});
