import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite, type SecurityObservation } from "@/lib/security/evidence";
import { deriverSignauxSecurite } from "@/lib/security/signals";
import { construireSecurityAnalysis } from "@/lib/security/analysis";
import { construireFindingsDepuisSignaux, confirmerManuel } from "@/lib/security/findings";
import { construireRootCausesDepuisFindings, identifierManuel as identifierRootCauseManuel } from "@/lib/security/rootcause";
import { construireImpactsDepuisFindings, construireRisquesDepuisImpacts, identifierImpactManuel, identifierRisqueManuel } from "@/lib/security/risk";
import { SECURITY_DOMAINS } from "@/lib/security/domain";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.10) — TESTS
// D'INTÉGRATION, chaîne complète. Contrairement aux tests unitaires de
// B13.1-B13.8 (chacun isole SON module) et à ceux de B13.9 (chaîne
// complète mais UNIQUEMENT via la route API, donc uniquement des
// observations PASS/CODE_REVIEW issues du registre statique), ce fichier
// exerce la chaîne ENTIÈRE — OBSERVATION -> SIGNAL -> ANALYSIS -> FINDING
// -> ROOT CAUSE -> IMPACT -> RISK — sur un jeu d'observations MIXTE
// (PASS/FAIL/WARNING/UNKNOWN, plusieurs domaines, plusieurs actifs,
// secret suspect, décisions humaines) directement au niveau des modules
// lib/security/*, sans passer par le serveur Next.js (pas de DB, pas de
// LLM — fonctions pures, même discipline que les autres tests unitaires
// de ce dossier). Objectif : garantir que les invariants de chaque lot
// tiennent aussi UNE FOIS COMPOSÉS ENSEMBLE, pas seulement en isolation.

function obs(overrides: Partial<EntreeObservationSecurite> = {}): SecurityObservation | null {
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
  return construireObservationSecurite(entree);
}

test.describe("Security Intelligence Foundation V1 — intégration de la chaîne complète", () => {
  test("1. jeu d'observations mixte (PASS/FAIL/WARNING/UNKNOWN, plusieurs domaines/actifs) : la chaîne complète s'exécute sans crash", () => {
    const observations = [
      obs({ statut: "PASS", label: "RBAC session", securityDomaine: "AUTHENTICATION" }),
      obs({
        statut: "FAIL",
        label: "Absence de rate limiting observée",
        preuve: "échec observé en CI",
        securityDomaine: "AUTHORIZATION",
        actif: { type: "API", identifiant: "GET /api/exemple" },
      }),
      obs({ statut: "WARNING", label: "Dépendance non auditée récemment", preuve: "avertissement npm audit", securityDomaine: "DEPENDENCIES" }),
      obs({ statut: "UNKNOWN", label: "Politique CSP non vérifiée", preuve: "aucune preuve disponible", securityDomaine: "CONFIGURATION" }),
    ].filter((o): o is SecurityObservation => o !== null);
    expect(observations.length).toBe(4);

    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    const impacts = construireImpactsDepuisFindings(findings, rootCauses);
    const risques = construireRisquesDepuisImpacts(findings, impacts);

    expect(Object.keys(analyse.parDomaine).length).toBe(13);
    expect(findings.length).toBeGreaterThan(0);
    expect(rootCauses.length).toBe(findings.length);
    expect(impacts.length).toBe(findings.length);
    expect(risques.length).toBe(findings.length);
  });

  test("2. GARANTIE STRUCTURELLE bout en bout : la dérivation automatique ne produit JAMAIS CONFIRMED/IDENTIFIED, quelle que soit l'entrée", () => {
    const observations = [
      obs({ statut: "FAIL", label: "a", preuve: "échec a", securityDomaine: "CRYPTOGRAPHY" }),
      obs({ statut: "FAIL", label: "b", preuve: "échec b", securityDomaine: "DATA_PROTECTION" }),
      obs({ statut: "WARNING", label: "c", preuve: "avertissement c", securityDomaine: "LOGGING" }),
      obs({ statut: "UNKNOWN", label: "d", preuve: "aucune preuve", securityDomaine: "INTEGRITY" }),
    ].filter((o): o is SecurityObservation => o !== null);

    const signaux = deriverSignauxSecurite(observations);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    const impacts = construireImpactsDepuisFindings(findings, rootCauses);
    const risques = construireRisquesDepuisImpacts(findings, impacts);

    expect(findings.every((f) => f.confiance !== "CONFIRMED")).toBe(true);
    expect(rootCauses.every((rc) => rc.statut === "UNKNOWN")).toBe(true);
    expect(impacts.every((i) => i.niveau === "UNKNOWN")).toBe(true);
    expect(risques.every((r) => r.niveau === "UNKNOWN" && r.recommandation === null)).toBe(true);
  });

  test("3. décision humaine bout en bout : confirmer un Finding, identifier sa RootCause/Impact/Risk ne modifie QUE l'objet ciblé, jamais les autres éléments de la chaîne", () => {
    const observations = [obs({ statut: "FAIL", label: "a", preuve: "échec a" })].filter((o): o is SecurityObservation => o !== null);
    const signaux = deriverSignauxSecurite(observations);
    const findingsBruts = construireFindingsDepuisSignaux(signaux);
    const [findingBrut] = findingsBruts;
    if (!findingBrut) throw new Error("finding de test attendu non produit — corriger le test");

    const [rootCauseBrute] = construireRootCausesDepuisFindings([findingBrut]);
    const impactBrut = construireImpactsDepuisFindings([findingBrut], [rootCauseBrute])[0];
    const risqueBrut = construireRisquesDepuisImpacts([findingBrut], [impactBrut])[0];

    const findingConfirme = confirmerManuel(findingBrut, "revue manuelle croisée avec les logs de production");
    const rootCauseIdentifiee = identifierRootCauseManuel(rootCauseBrute, "Absence de vérification côté serveur", "analyse manuelle du code");
    const impactIdentifie = identifierImpactManuel(impactBrut, "Exposition de données sensibles", "analyse manuelle de la portée");
    const risqueIdentifie = identifierRisqueManuel(risqueBrut, "Risque confirmé", "analyse manuelle", "Ajouter une validation serveur");

    // Les objets bruts d'origine restent inchangés — aucune mutation à distance.
    expect(findingBrut.confiance).toBe("OBSERVED");
    expect(rootCauseBrute.statut).toBe("UNKNOWN");
    expect(impactBrut.niveau).toBe("UNKNOWN");
    expect(risqueBrut.niveau).toBe("UNKNOWN");

    // Les décisions humaines ont bien produit des états plus forts, chacune indépendamment.
    expect(findingConfirme.confiance).toBe("CONFIRMED");
    expect(rootCauseIdentifiee.statut).toBe("IDENTIFIED");
    expect(impactIdentifie.niveau).toBe("IDENTIFIED");
    expect(risqueIdentifie.niveau).toBe("IDENTIFIED");
    expect(risqueIdentifie.recommandation).toBe("Ajouter une validation serveur");
  });

  test("4. fuite de secret bloquée en amont : une entrée suspecte n'atteint jamais Signal/Finding/RootCause/Impact/Risk (rejetée à la source, jamais nettoyée)", () => {
    const suspecte = obs({ statut: "FAIL", label: "Config lue", preuve: "password: hunter2ExempleFictif", securityDomaine: "SECRETS" });
    expect(suspecte).toBeNull();

    // Le pipeline complet appliqué à un tableau ne contenant AUCUNE observation
    // valide (toutes rejetées en amont) doit produire des tableaux vides,
    // jamais une exception, jamais une donnée fabriquée pour combler le vide.
    const observations: SecurityObservation[] = [];
    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    const findings = construireFindingsDepuisSignaux(signaux);
    expect(signaux).toEqual([]);
    expect(findings).toEqual([]);
    expect(Object.keys(analyse.parDomaine).length).toBe(13);
    expect(JSON.stringify(analyse)).not.toContain("hunter2");
  });

  test("5. UNKNOWN ne devient jamais un échec le long de la chaîne : une observation UNKNOWN produit au plus un signal MISSING_EVIDENCE, jamais un Finding de confiance supérieure à UNKNOWN", () => {
    const observation = obs({ statut: "UNKNOWN", label: "Politique de rotation des clés", preuve: "aucune preuve disponible", securityDomaine: "CRYPTOGRAPHY" });
    if (!observation) throw new Error("observation de test invalide — corriger le test");
    const signaux = deriverSignauxSecurite([observation]);
    const findings = construireFindingsDepuisSignaux(signaux);
    for (const s of signaux) {
      expect(s.type).toBe("MISSING_EVIDENCE");
    }
    for (const f of findings) {
      expect(f.confiance).toBe("UNKNOWN");
    }
  });

  test("6. aucun score/verdict global n'apparaît nulle part dans la structure produite par la chaîne complète", () => {
    const observations = [
      obs({ statut: "FAIL", label: "a", preuve: "échec a", securityDomaine: "API_SECURITY" }),
      obs({ statut: "WARNING", label: "b", preuve: "avertissement b", securityDomaine: "SUPPLY_CHAIN" }),
    ].filter((o): o is SecurityObservation => o !== null);
    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    const impacts = construireImpactsDepuisFindings(findings, rootCauses);
    const risques = construireRisquesDepuisImpacts(findings, impacts);

    const tout = JSON.stringify({ analyse, findings, rootCauses, impacts, risques });
    expect(tout).not.toContain("\"score\"");
    expect(tout).not.toContain("\"scoreGlobal\"");
    expect(tout).not.toContain("\"niveauGlobal\"");
    expect(tout).not.toContain("\"verdict\"");
  });

  test("7. déterminisme bout en bout : deux exécutions de la chaîne complète sur les mêmes observations produisent un résultat structurellement identique", () => {
    const observations = [
      obs({ statut: "FAIL", label: "a", preuve: "échec a", securityDomaine: "AUTHORIZATION" }),
      obs({ statut: "PASS", label: "b", securityDomaine: "AUTHENTICATION" }),
    ].filter((o): o is SecurityObservation => o !== null);

    function executerChaine() {
      const signaux = deriverSignauxSecurite(observations);
      const analyse = construireSecurityAnalysis(observations, signaux);
      const findings = construireFindingsDepuisSignaux(signaux);
      const rootCauses = construireRootCausesDepuisFindings(findings);
      const impacts = construireImpactsDepuisFindings(findings, rootCauses);
      const risques = construireRisquesDepuisImpacts(findings, impacts);
      return { analyse, findings, rootCauses, impacts, risques };
    }

    expect(JSON.stringify(executerChaine())).toBe(JSON.stringify(executerChaine()));
  });

  test("8. treize domaines toujours présents dans analyse.parDomaine même quand les observations n'en touchent qu'un seul", () => {
    const observations = [obs({ statut: "PASS", label: "a", securityDomaine: "LOGGING" })].filter((o): o is SecurityObservation => o !== null);
    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    expect(Object.keys(analyse.parDomaine).sort()).toEqual([...SECURITY_DOMAINS].sort());
    for (const domaine of SECURITY_DOMAINS) {
      if (domaine !== "LOGGING") {
        expect(analyse.parDomaine[domaine].observations).toEqual([]);
      }
    }
  });

  test("9. non-régression B1-B12 : aucune structure produite par la chaîne complète ne référence lib/scoring.ts ni lib/talent/", () => {
    const observations = [obs({ statut: "FAIL", label: "a", preuve: "échec a" })].filter((o): o is SecurityObservation => o !== null);
    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    const impacts = construireImpactsDepuisFindings(findings, rootCauses);
    const risques = construireRisquesDepuisImpacts(findings, impacts);
    const tout = JSON.stringify({ analyse, findings, rootCauses, impacts, risques });
    expect(tout).not.toContain("lib/scoring.ts");
    expect(tout).not.toContain("lib/talent/");
    expect(tout).not.toContain("talentTrust");
    expect(tout).not.toContain("candidateIntelligence");
  });
});
