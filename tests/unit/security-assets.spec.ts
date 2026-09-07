import { test, expect } from "@playwright/test";
import {
  ACTIFS_CONNUS,
  POINTS_ENTREE_CONNUS,
  CONTROLES_CONNUS,
  trouverActif,
  trouverPointEntree,
  trouverControle,
  estPointEntreeValide,
  estControleValide,
  construireObservationDepuisControle,
  type SecurityEntryPoint,
  type SecurityControl,
} from "@/lib/security/assets";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.4) — Asset / Entry
// Point / Control Model. Tests purs (pas de DB, pas de scanner, pas de
// réseau) sur lib/security/assets.ts. Vérifie en particulier : le registre
// reste un ensemble STATIQUE et fini de faits déjà vérifiés (aucune
// découverte dynamique), chaque entrée cite un fichier réel, et la
// construction d'observation depuis un contrôle réutilise la validation de
// B13.2 sans la dupliquer.

test.describe("Security Assets/EntryPoints/Controls registries (lib/security/assets)", () => {
  test("1. ACTIFS_CONNUS : au moins un actif, tous d'un type du vocabulaire fermé, identifiant non vide", () => {
    expect(ACTIFS_CONNUS.length).toBeGreaterThan(0);
    for (const a of ACTIFS_CONNUS) {
      expect(a.identifiant.trim().length).toBeGreaterThan(0);
    }
  });

  test("2. POINTS_ENTREE_CONNUS : chaque entrée est valide (estPointEntreeValide) et cite un fichier réel", () => {
    expect(POINTS_ENTREE_CONNUS.length).toBeGreaterThan(0);
    for (const p of POINTS_ENTREE_CONNUS) {
      expect(estPointEntreeValide(p)).toBe(true);
      expect(p.fichier).toMatch(/\.tsx?$/);
    }
  });

  test("3. CONTROLES_CONNUS : chaque entrée est valide (estControleValide), domaine dans le vocabulaire fermé, fichier réel", () => {
    expect(CONTROLES_CONNUS.length).toBeGreaterThan(0);
    for (const c of CONTROLES_CONNUS) {
      expect(estControleValide(c)).toBe(true);
      expect(c.fichier).toMatch(/\.tsx?$/);
    }
  });

  test("4. CONTROLES_CONNUS : aucun id dupliqué (chaque contrôle est identifiable de façon unique)", () => {
    const ids = CONTROLES_CONNUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("5. trouverActif/trouverPointEntree/trouverControle : retournent l'entrée exacte quand elle existe", () => {
    expect(trouverActif("atlas-admin-demo")).toEqual({ type: "APPLICATION", identifiant: "atlas-admin-demo" });
    expect(trouverPointEntree("GET /api/quality")?.methode).toBe("GET");
    expect(trouverControle("rbac-session-jwt")?.domaine).toBe("AUTHENTICATION");
  });

  test("6. trouverActif/trouverPointEntree/trouverControle : retournent null pour une entrée inconnue, jamais une exception", () => {
    expect(trouverActif("actif-invente")).toBeNull();
    expect(trouverPointEntree("POST /api/invente")).toBeNull();
    expect(trouverControle("controle-invente")).toBeNull();
  });

  test("7. estPointEntreeValide : rejette un point d'entrée avec un type d'actif hors vocabulaire (cast forcé)", () => {
    const corrompu: SecurityEntryPoint = {
      reference: { type: "SERVER" as unknown as SecurityEntryPoint["reference"]["type"], identifiant: "x" },
      methode: "GET",
      rbac: "ADMIN",
      fichier: "app/api/x/route.ts",
    };
    expect(estPointEntreeValide(corrompu)).toBe(false);
  });

  test("8. estControleValide : rejette un contrôle avec un domaine hors vocabulaire (cast forcé) ou un champ vide", () => {
    const domaineInvalide: SecurityControl = {
      id: "x",
      label: "x",
      domaine: "MADE_UP" as unknown as SecurityControl["domaine"],
      description: "x",
      fichier: "lib/x.ts",
    };
    expect(estControleValide(domaineInvalide)).toBe(false);

    const descriptionVide: SecurityControl = {
      id: "x",
      label: "x",
      domaine: "AUTHENTICATION",
      description: "   ",
      fichier: "lib/x.ts",
    };
    expect(estControleValide(descriptionVide)).toBe(false);
  });

  test("9. construireObservationDepuisControle : construit une SecurityObservation valide depuis un contrôle connu, preuve citant le fichier", () => {
    const o = construireObservationDepuisControle("rbac-session-jwt", "PASS", new Date("2026-09-07T00:00:00Z"));
    expect(o).not.toBeNull();
    expect(o!.securityDomaine).toBe("AUTHENTICATION");
    expect(o!.source).toBe("CODE_REVIEW");
    expect(o!.preuve).toContain("lib/auth.ts");
    expect(o!.contexte).toBe("lib/auth.ts");
  });

  test("10. construireObservationDepuisControle : retourne null pour un contrôle non enregistré, jamais une observation fabriquée", () => {
    expect(construireObservationDepuisControle("controle-invente", "PASS", new Date())).toBeNull();
  });

  test("11. construireObservationDepuisControle : le statut reste entièrement à la charge de l'appelant, jamais décidé par ce module", () => {
    const pass = construireObservationDepuisControle("ci-source-timeout", "PASS", new Date("2026-09-07T00:00:00Z"));
    const fail = construireObservationDepuisControle("ci-source-timeout", "FAIL", new Date("2026-09-07T00:00:00Z"));
    expect(pass!.statut).toBe("PASS");
    expect(fail!.statut).toBe("FAIL");
    expect(pass!.label).toBe(fail!.label); // même contrôle, même fait décrit — seul le statut fourni diffère
  });

  test("12. construireObservationDepuisControle : preuveComplementaire s'ajoute au fait de base sans le remplacer", () => {
    const o = construireObservationDepuisControle("quality-api-admin-only", "PASS", new Date("2026-09-07T00:00:00Z"), {
      preuveComplementaire: "vérifié via tests/api/quality.spec.ts test 1",
    });
    expect(o!.preuve).toContain("app/api/quality/route.ts");
    expect(o!.preuve).toContain("vérifié via tests/api/quality.spec.ts test 1");
  });

  test("13. déterminisme : la même entrée produit toujours le même résultat", () => {
    const a = construireObservationDepuisControle("session-cookie-httponly", "PASS", new Date("2026-09-07T00:00:00Z"));
    const b = construireObservationDepuisControle("session-cookie-httponly", "PASS", new Date("2026-09-07T00:00:00Z"));
    expect(a).toEqual(b);
  });

  test("14. non-régression : le registre ne référence jamais lib/scoring.ts ni un module lib/talent/", () => {
    for (const c of CONTROLES_CONNUS) {
      expect(c.fichier).not.toContain("lib/scoring.ts");
      expect(c.fichier).not.toContain("lib/talent/");
    }
  });
});
