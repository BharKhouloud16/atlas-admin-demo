import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { calculerPlafondAutonomie, type ParametresPlafondAutonomie } from "@/lib/control-plane/autonomy";
import type { Delegation } from "@prisma/client";

// COMPANY ATLAS — B23 LOT 1 : AUTONOMY CEILING (fonction pure).
// Aucun accès base de données ici — calculerPlafondAutonomie ne prend
// que des données déjà résolues par l'appelant (voir lib/control-plane/
// autonomy.ts). Confirme aussi, par lecture statique du fichier source,
// qu'aucune écriture Prisma n'est jamais possible depuis ce module.

const AGENT_ACTIF = { statut: "ACTIVE" as const };
const AGENT_INACTIF = { statut: "DISABLED" as const };

// Fixture générique — accorde toutes les actions non-EXECUTE (READ,
// ANALYZE, REPORT, PROPOSE, WRITE) pour isoler chaque test sur la
// dimension qu'il vérifie réellement, sans que le choix de `action`
// dans un test donné ne déclenche accidentellement un blocage PERMISSION
// non désiré.
function permissionsAgentActif(agentId: string, scope: "TALENT" | "SECURITY" | "COMPANY_OS" | "PRINCIPAL" = "TALENT") {
  return (["READ", "ANALYZE", "REPORT", "PROPOSE", "WRITE"] as const).map((action) => ({
    agentId,
    action,
    scope,
    statut: "ACTIVE" as const,
  }));
}

function delegationFixture(overrides: Partial<Record<string, unknown>> = {}): Delegation {
  return {
    id: "delegation-test",
    correlationId: "test",
    agentId: "agent-1",
    action: "PROPOSE",
    scope: "TALENT",
    resource: null,
    objective: "test",
    actionClass: "INTERNAL_ACTION",
    maxAmount: null,
    maxRiskLevel: null,
    conditions: null,
    startsAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 3600_000),
    status: "ACTIVE",
    createdBy: "admin-demo@example.com",
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Delegation;
}

function paramsBase(overrides: Partial<ParametresPlafondAutonomie> = {}): ParametresPlafondAutonomie {
  return {
    agent: AGENT_ACTIF,
    agentId: "agent-1",
    action: "PROPOSE",
    scope: "TALENT",
    permissions: permissionsAgentActif("agent-1"),
    delegation: null,
    emergencyStopActif: false,
    requestedAutonomyLevel: "L1_ANALYZE",
    ...overrides,
  };
}

test.describe("COMPANY ATLAS B23 Lot 1 — Autonomy Ceiling (calculerPlafondAutonomie, fonction pure)", () => {
  // ==========================================================================
  // 1-5 : niveaux L0 à L4 demandés, tous acceptables (aucune restriction
  // par ailleurs) — le ceiling suit le plafond gouvernance/action/etc.,
  // jamais bloqué simplement par le niveau demandé.

  for (const niveau of ["L0_OBSERVE", "L1_ANALYZE", "L2_RECOMMEND", "L3_PREPARE", "L4_EXECUTE_WITH_APPROVAL"] as const) {
    test(`${niveau} demandé, contexte nominal -> accepté (ceiling = min(demandé, plafonds), jamais bloqué)`, () => {
      const resultat = calculerPlafondAutonomie(paramsBase({ requestedAutonomyLevel: niveau, action: "READ" }));
      expect(resultat.blocked).toBe(false);
      expect(resultat.requestedAutonomy).toBe(niveau);
      // READ -> OBSERVATION -> plafond ACTION_CLASS = L4 ; aucune autre
      // restriction ici -> le ceiling final est exactement le niveau
      // demandé (jamais supérieur).
      expect(resultat.autonomyCeiling).toBe(niveau);
    });
  }

  // ==========================================================================
  // 6-7 : L5/L6 — interdits, aucun calcul ne peut les autoriser.

  test("L5_EXECUTE_WITH_GUARDRAILS demandé -> jamais accordé, ceiling ramené à L4 maximum", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ requestedAutonomyLevel: "L5_EXECUTE_WITH_GUARDRAILS", action: "READ" }));
    expect(resultat.autonomyCeiling).toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(resultat.autonomyCeiling).not.toBe("L5_EXECUTE_WITH_GUARDRAILS");
  });

  test("L6_AUTONOMOUS demandé -> jamais accordé, ceiling ramené à L4 maximum", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ requestedAutonomyLevel: "L6_AUTONOMOUS", action: "READ" }));
    expect(resultat.autonomyCeiling).toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(resultat.autonomyCeiling).not.toBe("L6_AUTONOMOUS");
  });

  test("aucune combinaison de facteurs favorables ne peut jamais produire un ceiling L5/L6", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        requestedAutonomyLevel: "L6_AUTONOMOUS",
        action: "READ",
        riskLevel: "LOW",
        evidenceQuality: "VERIFIED",
      })
    );
    expect(["L0_OBSERVE", "L1_ANALYZE", "L2_RECOMMEND", "L3_PREPARE", "L4_EXECUTE_WITH_APPROVAL"]).toContain(resultat.autonomyCeiling);
  });

  // ==========================================================================
  // 8-9 : Permission / Identity — bloquants, jamais un simple plafond bas.

  test("permission inactive (aucune AgentPermission ACTIVE) -> blocked, ceiling L0_OBSERVE", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ permissions: [] }));
    expect(resultat.blocked).toBe(true);
    expect(resultat.allowedForEvaluation).toBe(false);
    expect(resultat.autonomyCeiling).toBe("L0_OBSERVE");
    expect(resultat.reasons.some((r) => r.dimension === "PERMISSION" && r.bloquant)).toBe(true);
  });

  test("agent inactif (AgentIdentity DISABLED) -> blocked, ceiling L0_OBSERVE", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ agent: AGENT_INACTIF }));
    expect(resultat.blocked).toBe(true);
    expect(resultat.reasons.some((r) => r.dimension === "IDENTITY" && r.bloquant)).toBe(true);
  });

  test("agent introuvable (agent: null) -> blocked, traité comme non ACTIVE", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ agent: null }));
    expect(resultat.blocked).toBe(true);
  });

  // ==========================================================================
  // 10 : Emergency Stop — court-circuit total, jamais une simple
  // recommandation d'autonomie réduite.

  test("Emergency Stop actif -> blocked, court-circuit total, jamais un simple plafond réduit", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ emergencyStopActif: true }));
    expect(resultat.blocked).toBe(true);
    expect(resultat.autonomyCeiling).toBe("L0_OBSERVE");
    const raisonStop = resultat.reasons.find((r) => r.dimension === "EMERGENCY_STOP");
    expect(raisonStop?.bloquant).toBe(true);
    expect(raisonStop?.plafond).toBeNull();
  });

  // ==========================================================================
  // 11 : Action inconnue -> COMMITMENT (classifierAction, fail-closed).

  test("action inconnue/malformée -> classifiée COMMITMENT, ceiling plafonné en conséquence, jamais OBSERVATION", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ action: "DELETE_EVERYTHING", permissions: [] }));
    const raisonActionClass = resultat.reasons.find((r) => r.dimension === "ACTION_CLASS");
    expect(raisonActionClass?.detail).toContain("COMMITMENT");
    expect(raisonActionClass?.plafond).toBe("L1_ANALYZE");
  });

  // ==========================================================================
  // 12 : Evidence UNKNOWN -> plafond réduit, jamais transformé en certitude.

  test("evidenceQuality UNKNOWN -> plafond réduit à L1_ANALYZE sur cette dimension", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ evidenceQuality: "UNKNOWN", action: "READ" }));
    const raison = resultat.reasons.find((r) => r.dimension === "EVIDENCE");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
  });

  // ==========================================================================
  // 13-16 : Risk — table fermée LOW/MEDIUM/HIGH/CRITICAL, jamais une formule.

  test("Risk LOW -> plafond L4 (aucune restriction)", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ riskLevel: "LOW", action: "READ" }));
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
  });

  test("Risk MEDIUM -> plafond L3", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ riskLevel: "MEDIUM", action: "READ" }));
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L3_PREPARE");
  });

  test("Risk HIGH -> plafond L2", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ riskLevel: "HIGH", action: "READ" }));
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L2_RECOMMEND");
  });

  test("Risk CRITICAL -> plafond L1", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ riskLevel: "CRITICAL", action: "READ" }));
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L1_ANALYZE");
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
  });

  // ==========================================================================
  // 17-20 : Delegation absente/expirée/révoquée/couvrante.

  test("Delegation absente, aucun montant/risque déclaré -> aucune restriction (delegation non nécessaire)", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ delegation: null, action: "READ" }));
    expect(resultat.reasons.find((r) => r.dimension === "DELEGATION")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
  });

  test("Delegation expirée -> jamais interprétée comme illimitée, plafond réduit, jamais bloquant", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ expiresAt: new Date(Date.now() - 1000) }),
        montantDemande: 100,
      })
    );
    const raison = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.bloquant).toBe(false);
    expect(resultat.blocked).toBe(false);
  });

  test("Delegation révoquée -> jamais interprétée comme illimitée, plafond réduit, jamais bloquant", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ status: "REVOKED" }),
        montantDemande: 100,
      })
    );
    const raison = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.bloquant).toBe(false);
  });

  test("Delegation couvrante -> aucune restriction sur cette dimension", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ maxAmount: 5000, maxRiskLevel: "HIGH" }),
        montantDemande: 100,
        riskLevel: "LOW",
      })
    );
    expect(resultat.reasons.find((r) => r.dimension === "DELEGATION")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
  });

  // ==========================================================================
  // 21-22 : Montant/risque dépassant la délégation — jamais un blocage,
  // jamais une contradiction avec B22-FIX2 (décision humaine toujours
  // possible via AuthorizationRequest, seule l'autonomie automatique
  // change ici).

  test("Montant demandé dépassant la Delegation.maxAmount -> plafond réduit, jamais bloquant (décision humaine B22 reste possible)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ maxAmount: 2000 }),
        montantDemande: 3000,
      })
    );
    const raison = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.bloquant).toBe(false);
    expect(resultat.blocked).toBe(false);
    expect(resultat.allowedForEvaluation).toBe(true);
  });

  test("Risque demandé dépassant la Delegation.maxRiskLevel -> plafond réduit, jamais bloquant", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ maxRiskLevel: "MEDIUM" }),
        riskLevel: "HIGH",
      })
    );
    const raison = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.bloquant).toBe(false);
  });

  // ==========================================================================
  // 23 : Human ALLOW jamais bloqué par une réduction de ceiling — cette
  // fonction ne touche structurellement jamais à AuthorizationRequest,
  // donc `blocked` ne peut JAMAIS devenir true à cause d'une simple
  // insuffisance de délégation (seules Identity/Permission/Emergency Stop
  // le peuvent).

  test("un ceiling très bas dû à une délégation insuffisante n'implique jamais blocked=true (une décision humaine B22 reste possible)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ maxAmount: 10 }),
        montantDemande: 999999,
        riskLevel: "CRITICAL",
        evidenceQuality: "UNKNOWN",
      })
    );
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
    expect(resultat.blocked).toBe(false);
    expect(resultat.allowedForEvaluation).toBe(true);
  });

  // ==========================================================================
  // 24-27 : aucune écriture DB possible — vérifié par lecture statique du
  // fichier source (bien plus fort qu'un simple "le test a réussi sans
  // base de données") : ce module ne doit contenir AUCUN import ni appel
  // Prisma d'écriture.

  test("24-27 : le module autonomy.ts ne contient aucun accès Prisma en écriture (aucune modification Delegation/Permission/Identity/EmergencyStop possible)", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "control-plane", "autonomy.ts"), "utf-8");

    // Aucun import du client Prisma runtime (seul un import de TYPE est
    // toléré et vérifié séparément ci-dessous — un import de type est
    // entièrement effacé à la compilation, aucune empreinte à l'exécution).
    expect(source).not.toContain('from "@/lib/prisma"');
    expect(source).not.toContain("prisma.");

    // Aucune méthode d'écriture Prisma, sous quelque forme que ce soit.
    for (const motif of [".create(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw", "$queryRaw", "$transaction("]) {
      expect(source, `motif interdit trouvé : ${motif}`).not.toContain(motif);
    }

    // Le seul import lié à Prisma toléré est un import de TYPE (effacé à
    // la compilation, donc sans aucune empreinte d'exécution).
    const importsPrisma = source.match(/^import .*@prisma\/client.*$/gm) ?? [];
    for (const ligne of importsPrisma) {
      expect(ligne, "seul un import de type est toléré depuis @prisma/client").toMatch(/^import type /);
    }
  });

  test("24-27 (fonctionnel) : deux appels successifs identiques produisent exactement le même résultat — aucun effet de bord, aucun état mémorisé", () => {
    const params = paramsBase({
      action: "PROPOSE",
      delegation: delegationFixture({ maxAmount: 2000 }),
      montantDemande: 3000,
    });
    const premier = calculerPlafondAutonomie(params);
    const second = calculerPlafondAutonomie(params);
    expect(premier).toEqual(second);
  });

  // ==========================================================================
  // Combinaison de plusieurs plafonds — le résultat doit toujours être le
  // plus restrictif applicable (MIN), jamais une moyenne, jamais le
  // dernier facteur évalué.

  test("combinaison de plusieurs plafonds -> le résultat est toujours le plus restrictif applicable (MIN strict)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE", // INTERNAL_ACTION -> plafond L3
        riskLevel: "MEDIUM", // -> plafond L3
        evidenceQuality: "UNKNOWN", // -> plafond L1 (le plus restrictif de cette combinaison)
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
      })
    );
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
  });

  test("combinaison : demande L2, action nominale sans risque/preuve déclarés -> ceiling = niveau demandé (aucune dimension plus restrictive)", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ action: "READ", requestedAutonomyLevel: "L2_RECOMMEND" }));
    expect(resultat.autonomyCeiling).toBe("L2_RECOMMEND");
  });

  // ==========================================================================
  // Human Necessity — réutilisation stricte, jamais un second moteur.

  test("humanNecessity provient de calculerHumanNecessity (B22) — H4 sur montant dépassé, cohérent avec B22", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        delegation: delegationFixture({ maxAmount: 100 }),
        montantDemande: 999,
      })
    );
    expect(resultat.humanNecessity).toBe("H4");
  });

  // ==========================================================================
  // B23-FIX1 (audit humain PR #9) — Correction P0 : Permission + scope
  // exacts (agentId + action + scope + ACTIVE), jamais seulement
  // agentId + action.

  test("B23-FIX1 P0 : agent PROPOSE+TALENT ACTIVE demandant PROPOSE+TALENT -> accepté, PERMISSION non bloquante", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({ action: "PROPOSE", scope: "TALENT", permissions: permissionsAgentActif("agent-1", "TALENT") })
    );
    expect(resultat.blocked).toBe(false);
    const raison = resultat.reasons.find((r) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(false);
    expect(raison?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
  });

  test("B23-FIX1 P0 : même agent (permission ACTIVE seulement en scope TALENT) demandant PROPOSE+SECURITY -> blocked (permission insuffisante, hors scope)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({ action: "PROPOSE", scope: "SECURITY", permissions: permissionsAgentActif("agent-1", "TALENT") })
    );
    expect(resultat.blocked).toBe(true);
    expect(resultat.allowedForEvaluation).toBe(false);
    expect(resultat.autonomyCeiling).toBe("L0_OBSERVE");
    const raison = resultat.reasons.find((r) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(true);
    expect(raison?.plafond).toBeNull();
  });

  test("B23-FIX1 P0 : permission DISABLED pour cet agent/action/scope exacts -> jamais considérée active, blocked", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        scope: "TALENT",
        permissions: [{ agentId: "agent-1", action: "PROPOSE", scope: "TALENT", statut: "DISABLED" }],
      })
    );
    expect(resultat.blocked).toBe(true);
    expect(resultat.reasons.find((r) => r.dimension === "PERMISSION")?.bloquant).toBe(true);
  });

  test("B23-FIX1 P0 : scope invalide/inconnu -> jamais une autorisation implicite, blocked (fail-closed, jamais une correspondance par défaut)", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ scope: "SUPER_GLOBAL_SCOPE" }));
    expect(resultat.blocked).toBe(true);
    const raison = resultat.reasons.find((r) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(true);
    expect(raison?.detail).toContain("scope invalide");
  });

  test("B23-FIX1 P0 : scope valide et correspondant -> aucune restriction implicite liée au scope lui-même", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ action: "READ", scope: "TALENT" }));
    expect(resultat.blocked).toBe(false);
    expect(resultat.reasons.find((r) => r.dimension === "PERMISSION")?.bloquant).toBe(false);
  });

  test("B23-FIX1 P0 : Delegation SECURITY non couverte quand l'agent ne détient que la permission TALENT (scope exact requis, estDelegationCouvrante)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        scope: "SECURITY",
        permissions: permissionsAgentActif("agent-1", "TALENT"),
        delegation: delegationFixture({ scope: "SECURITY", maxAmount: 5000, maxRiskLevel: "HIGH" }),
        montantDemande: 100,
      })
    );
    // La permission SECURITY est absente -> bloqué au niveau PERMISSION.
    expect(resultat.blocked).toBe(true);
    // Et la dimension DELEGATION elle-même ne considère jamais cette
    // Delegation comme couvrante : la permission sous-jacente exacte
    // (agentId+action+SECURITY+ACTIVE) est absente.
    const raisonDelegation = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raisonDelegation?.plafond).toBe("L1_ANALYZE");
    expect(raisonDelegation?.detail).toContain("désactivée");
  });

  test("B23-FIX1 P0 : délégation insuffisante (montant dépassé) reste jamais bloquante quand Identity/Permission/Emergency Stop sont valides (B22-FIX2 non réintroduit)", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({
        action: "PROPOSE",
        scope: "TALENT",
        permissions: permissionsAgentActif("agent-1", "TALENT"),
        delegation: delegationFixture({ scope: "TALENT", maxAmount: 10 }),
        montantDemande: 999999,
      })
    );
    expect(resultat.blocked).toBe(false);
    expect(resultat.allowedForEvaluation).toBe(true);
    const raisonDelegation = resultat.reasons.find((r) => r.dimension === "DELEGATION");
    expect(raisonDelegation?.bloquant).toBe(false);
    expect(raisonDelegation?.plafond).toBe("L1_ANALYZE");
  });

  // ==========================================================================
  // B23-FIX1 (audit humain PR #9) — Correction P1 : runtime fail-closed.
  // Une valeur EXPLICITEMENT fournie mais hors du vocabulaire fermé ne
  // doit jamais être traitée comme une absence de valeur (jamais L4 par
  // défaut) — comportement distinct de l'absence réelle (undefined/null).

  test("B23-FIX1 P1 : riskLevel LOW/MEDIUM/HIGH/CRITICAL -> comportement inchangé (non-régression)", () => {
    const attendus: Record<string, string> = {
      LOW: "L4_EXECUTE_WITH_APPROVAL",
      MEDIUM: "L3_PREPARE",
      HIGH: "L2_RECOMMEND",
      CRITICAL: "L1_ANALYZE",
    };
    for (const [risque, plafondAttendu] of Object.entries(attendus)) {
      const resultat = calculerPlafondAutonomie(paramsBase({ action: "READ", riskLevel: risque as never }));
      expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe(plafondAttendu);
    }
  });

  test("B23-FIX1 P1 : riskLevel invalide (hors vocabulaire fermé) -> fail-closed, jamais L4 par défaut, jamais bloquant", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ action: "READ", riskLevel: "SUPER_DANGEROUS" as never }));
    const raison = resultat.reasons.find((r) => r.dimension === "RISK");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.plafond).not.toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(raison?.bloquant).toBe(false);
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
    expect(resultat.blocked).toBe(false);
  });

  test("B23-FIX1 P1 : evidenceQuality VERIFIED/UNKNOWN -> comportement inchangé (non-régression)", () => {
    const resultatVerifie = calculerPlafondAutonomie(paramsBase({ action: "READ", evidenceQuality: "VERIFIED" }));
    expect(resultatVerifie.reasons.find((r) => r.dimension === "EVIDENCE")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");

    const resultatInconnu = calculerPlafondAutonomie(paramsBase({ action: "READ", evidenceQuality: "UNKNOWN" }));
    expect(resultatInconnu.reasons.find((r) => r.dimension === "EVIDENCE")?.plafond).toBe("L1_ANALYZE");
  });

  test("B23-FIX1 P1 : evidenceQuality invalide (hors vocabulaire fermé) -> fail-closed, jamais L4 par défaut, jamais bloquant", () => {
    const resultat = calculerPlafondAutonomie(paramsBase({ action: "READ", evidenceQuality: "TOTALLY_SURE" as never }));
    const raison = resultat.reasons.find((r) => r.dimension === "EVIDENCE");
    expect(raison?.plafond).toBe("L1_ANALYZE");
    expect(raison?.plafond).not.toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(raison?.bloquant).toBe(false);
    expect(resultat.autonomyCeiling).toBe("L1_ANALYZE");
    expect(resultat.blocked).toBe(false);
  });

  test("B23-FIX1 P1 : riskLevel/evidenceQuality réellement absents (undefined) restent neutres — jamais confondus avec une valeur invalide", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({ action: "READ", riskLevel: undefined, evidenceQuality: undefined })
    );
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(resultat.reasons.find((r) => r.dimension === "EVIDENCE")?.plafond).toBe("L4_EXECUTE_WITH_APPROVAL");
  });

  test("B23-FIX1 : combinaison riskLevel invalide + scope invalide -> le résultat reste le plus restrictif applicable (MIN strict), jamais L4", () => {
    const resultat = calculerPlafondAutonomie(
      paramsBase({ action: "READ", scope: "NOT_A_REAL_SCOPE", riskLevel: "MEGA_RISK" as never })
    );
    expect(resultat.blocked).toBe(true);
    expect(resultat.autonomyCeiling).toBe("L0_OBSERVE");
    expect(resultat.reasons.find((r) => r.dimension === "PERMISSION")?.bloquant).toBe(true);
    expect(resultat.reasons.find((r) => r.dimension === "RISK")?.plafond).toBe("L1_ANALYZE");
  });
});
