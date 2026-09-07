import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite, type SecurityObservation } from "@/lib/security/evidence";
import { deriverSignauxSecurite } from "@/lib/security/signals";
import {
  construireSecurityAnalysis,
  construireSecurityDomainSnapshot,
  construireTousLesSecurityDomainSnapshots,
  grouperParActif,
} from "@/lib/security/analysis";
import { ACTIFS_CONNUS, CONTROLES_CONNUS } from "@/lib/security/assets";
import { SECURITY_DOMAINS } from "@/lib/security/domain";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.5) — Security
// Analysis V1. Tests purs (pas de DB, pas de scanner, pas de LLM) sur
// lib/security/analysis.ts. Vérifie en particulier : les 13 domaines sont
// toujours présents (même vides), le regroupement par actif relit
// uniquement le champ déjà posé sur chaque observation (aucune déduction),
// aucun champ de score/verdict n'est jamais produit, déterminisme,
// non-régression B1-B12.

function obs(overrides: Partial<EntreeObservationSecurite> = {}): SecurityObservation {
  const entree: EntreeObservationSecurite = {
    statut: "PASS",
    label: "Cookie de session marqué HttpOnly",
    preuve: "lib/auth.ts createSession() : httpOnly: true",
    source: "CODE_REVIEW",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    securityDomaine: "SESSION_SECURITY",
    contexte: "lib/auth.ts",
    provenanceDetail: null,
    ...overrides,
  };
  const o = construireObservationSecurite(entree);
  if (!o) throw new Error("observation de test invalide — corriger le test, jamais le module");
  return o;
}

test.describe("Security Analysis V1 (lib/security/analysis) — vue par domaine", () => {
  test("1. construireTousLesSecurityDomainSnapshots : les 13 domaines sont toujours présents, même sans observation", () => {
    const snapshots = construireTousLesSecurityDomainSnapshots([], []);
    expect(Object.keys(snapshots).sort()).toEqual([...SECURITY_DOMAINS].sort());
    for (const domaine of SECURITY_DOMAINS) {
      expect(snapshots[domaine].observations).toEqual([]);
      expect(snapshots[domaine].signaux).toEqual([]);
    }
  });

  test("2. construireSecurityDomainSnapshot : filtre correctement observations/signaux par domaine", () => {
    const a = obs({ statut: "FAIL", preuve: "echec a", securityDomaine: "AUTHENTICATION" });
    const b = obs({ statut: "FAIL", preuve: "echec b", securityDomaine: "SECRETS" });
    const signaux = deriverSignauxSecurite([a, b]);

    const snapAuth = construireSecurityDomainSnapshot("AUTHENTICATION", [a, b], signaux);
    expect(snapAuth.observations).toEqual([a]);
    expect(snapAuth.signaux.every((s) => s.securityDomaine === "AUTHENTICATION")).toBe(true);

    const snapSecrets = construireSecurityDomainSnapshot("SECRETS", [a, b], signaux);
    expect(snapSecrets.observations).toEqual([b]);
  });

  test("3. observationsParStatut couvre les 8 statuts (même vides), signauxParType ne liste que les types rencontrés", () => {
    const snap = construireSecurityDomainSnapshot("AUTHENTICATION", [], []);
    expect(Object.keys(snap.observationsParStatut).sort()).toEqual(
      ["BLOCKED", "FAIL", "NOT_APPLICABLE", "NOT_EVALUATED", "OBSERVED", "PASS", "UNKNOWN", "WARNING"].sort()
    );
    expect(snap.signauxParType).toEqual({});
  });

  test("4. controlesDuDomaine reprend exactement les contrôles connus (B13.4) de ce domaine, aucun recalcul", () => {
    const snap = construireSecurityDomainSnapshot("AUTHENTICATION", [], []);
    const attendus = CONTROLES_CONNUS.filter((c) => c.domaine === "AUTHENTICATION");
    expect(snap.controlesDuDomaine).toEqual(attendus);
    expect(snap.controlesDuDomaine.length).toBeGreaterThan(0);
  });
});

test.describe("Security Analysis V1 (lib/security/analysis) — regroupement par actif", () => {
  test("5. grouperParActif : un groupe par actif connu (même sans observation), plus un groupe NON_ASSOCIE", () => {
    const groupes = grouperParActif([], []);
    expect(groupes.length).toBe(ACTIFS_CONNUS.length + 1);
    expect(groupes.some((g) => g.actif === null)).toBe(true);
    for (const g of groupes) {
      expect(g.observations).toEqual([]);
    }
  });

  test("6. grouperParActif : une observation avec actif va dans le bon groupe, jamais dans NON_ASSOCIE", () => {
    const cible = ACTIFS_CONNUS[0];
    const o = obs({ statut: "FAIL", preuve: "echec observe", actif: cible });
    const groupes = grouperParActif([o], []);
    const groupeCible = groupes.find((g) => g.actif && g.actif.identifiant === cible.identifiant);
    expect(groupeCible!.observations).toEqual([o]);
    const groupeNonAssocie = groupes.find((g) => g.actif === null);
    expect(groupeNonAssocie!.observations).toEqual([]);
  });

  test("7. grouperParActif : une observation sans actif va dans NON_ASSOCIE", () => {
    const o = obs({ statut: "WARNING", preuve: "avertissement sans actif associé" });
    const groupes = grouperParActif([o], []);
    const groupeNonAssocie = groupes.find((g) => g.actif === null);
    expect(groupeNonAssocie!.observations).toEqual([o]);
  });

  test("8. grouperParActif : un actif cité par une observation mais absent du registre reste visible (jamais ignoré)", () => {
    const actifInconnu = { type: "COMPONENT" as const, identifiant: "composant-non-enregistre" };
    const o = obs({ statut: "FAIL", preuve: "echec observe", actif: actifInconnu });
    const groupes = grouperParActif([o], []);
    const groupe = groupes.find((g) => g.actif && g.actif.identifiant === "composant-non-enregistre");
    expect(groupe).toBeDefined();
    expect(groupe!.observations).toEqual([o]);
  });

  test("9. grouperParActif : les signaux suivent le même regroupement que leurs observations d'origine", () => {
    const cible = ACTIFS_CONNUS[0];
    const o = obs({ statut: "FAIL", preuve: "echec observe", actif: cible });
    const signaux = deriverSignauxSecurite([o]);
    const groupes = grouperParActif([o], signaux);
    const groupeCible = groupes.find((g) => g.actif && g.actif.identifiant === cible.identifiant);
    expect(groupeCible!.signaux).toEqual(signaux);
  });
});

test.describe("Security Analysis V1 (lib/security/analysis) — assemblage complet et non-régression", () => {
  test("10. construireSecurityAnalysis : assemble domaines + actifs + registres connus, sans erreur sur entrée vide", () => {
    const analyse = construireSecurityAnalysis([], []);
    expect(Object.keys(analyse.parDomaine).length).toBe(SECURITY_DOMAINS.length);
    expect(analyse.parActif.length).toBe(ACTIFS_CONNUS.length + 1);
    expect(analyse.actifsConnus).toEqual(ACTIFS_CONNUS);
    expect(analyse.controlesConnus).toEqual(CONTROLES_CONNUS);
  });

  test("11. aucun champ de score, verdict ou priorisation n'est jamais produit par ce module", () => {
    const analyse = construireSecurityAnalysis([obs({ statut: "FAIL", preuve: "echec observe" })], []);
    const snap = analyse.parDomaine.SESSION_SECURITY;
    expect(snap).not.toHaveProperty("score");
    expect(snap).not.toHaveProperty("verdict");
    expect(snap).not.toHaveProperty("priorite");
    expect(analyse).not.toHaveProperty("scoreGlobal");
  });

  test("12. déterminisme : les mêmes observations/signaux produisent toujours le même résultat", () => {
    const observations = [obs({ statut: "FAIL", label: "a", preuve: "echec a" }), obs({ statut: "WARNING", label: "b" })];
    const signaux = deriverSignauxSecurite(observations);
    expect(construireSecurityAnalysis(observations, signaux)).toEqual(construireSecurityAnalysis(observations, signaux));
  });

  test("13. non-régression : ce module ne touche jamais lib/scoring.ts ni lib/talent/ (aucune référence dans les registres réutilisés)", () => {
    for (const c of CONTROLES_CONNUS) {
      expect(c.fichier).not.toContain("lib/scoring.ts");
      expect(c.fichier).not.toContain("lib/talent/");
    }
  });

  test("14. ne mute jamais les tableaux reçus en entrée", () => {
    const observations = [obs({ statut: "FAIL", preuve: "echec observe" })];
    const signaux = deriverSignauxSecurite(observations);
    const copieObservations = [...observations];
    const copieSignaux = [...signaux];
    construireSecurityAnalysis(observations, signaux);
    expect(observations).toEqual(copieObservations);
    expect(signaux).toEqual(copieSignaux);
  });
});
