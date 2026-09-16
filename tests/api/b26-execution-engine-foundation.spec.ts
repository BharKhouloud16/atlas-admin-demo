import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { executerActionControlee, type ActionAdapter } from "@/lib/control-plane/execution-engine";
import * as executionEngineModule from "@/lib/control-plane/execution-engine";
import { creerDemandeAutorisation } from "@/lib/control-plane/authorization";
import { activerArretUrgence, leverArretUrgence } from "@/lib/control-plane/emergency-stop";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B26 (14/09/2026) : EXECUTION ENGINE FOUNDATION.
// Couvre : "aucune action ne peut s'exécuter sans passer par le Guard"
// (ALLOW invoque l'adapter, tout le reste ne l'invoque JAMAIS), gestion de
// l'échec adapter (retour ok:false et exception), traçabilité, et un test
// structurel confirmant qu'aucun second point d'entrée n'existe dans le
// module. L'adapter utilisé ici est un FIXTURE DE TEST synthétique — ce
// lot ne câble AUCUNE action métier réelle (voir en-tête de
// lib/control-plane/execution-engine.ts).

async function idAgentDirect(nom: "ATLAS_TALENT"): Promise<string> {
  const agent = await prisma.agentIdentity.findFirst({ where: { agent: nom } });
  if (!agent) throw new Error(`Agent ${nom} introuvable`);
  return agent.id;
}

async function demandeApprouveeAutomatiquement(agentId: string) {
  const correlationId = nouveauCorrelationId();
  const resultat = await creerDemandeAutorisation({
    correlationId,
    agentId,
    action: "PROPOSE",
    scope: "TALENT",
    objective: "Test B26 Execution Engine",
    reason: "Test B26 Execution Engine",
    requestedAutonomyLevel: "L2_RECOMMEND",
  });
  if (!resultat.ok) throw new Error(resultat.erreur);
  expect(resultat.decision).toBe("ALLOW");
  return { authorizationRequestId: resultat.id, correlationId };
}

function compteurAdapter(): { adapter: ActionAdapter; appels: number[] } {
  const appels: number[] = [];
  const adapter: ActionAdapter = async () => {
    appels.push(Date.now());
    return { ok: true, detail: "Fixture de test B26 — aucune action métier réelle." };
  };
  return { adapter, appels };
}

test.describe("COMPANY ATLAS B26 — Execution Engine Foundation", () => {
  test("STRUCTUREL — le module n'exporte qu'un seul point d'entrée exécutable (aucun second chemin d'invocation d'un adapter)", () => {
    const exportsValeurs = Object.keys(executionEngineModule);
    expect(exportsValeurs).toEqual(["executerActionControlee"]);
  });

  test("ALLOW — l'adapter est invoqué exactement une fois, avec le contexte revalidé par le Guard, et le résultat est tracé (execute:SUCCESS)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    let contexteRecu: unknown = null;
    const adapter: ActionAdapter = async (contexte) => {
      contexteRecu = contexte;
      return { ok: true, detail: "Fixture de test B26.", data: { note: "aucune action métier réelle" } };
    };

    const resultat = await executerActionControlee(
      { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId },
      adapter
    );

    expect(resultat.executed).toBe(true);
    if (!resultat.executed) throw new Error("unreachable");
    expect(resultat.guard.decision).toBe("ALLOW");
    expect(resultat.resultat.ok).toBe(true);
    expect(contexteRecu).toEqual({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId });

    const evenements = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "execute:SUCCESS" },
    });
    expect(evenements.length).toBeGreaterThan(0);
  });

  test("DENY (Guard) — l'adapter n'est JAMAIS invoqué", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    const { adapter, appels } = compteurAdapter();
    try {
      const resultat = await executerActionControlee(
        { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId },
        adapter
      );
      expect(resultat.executed).toBe(false);
      if (resultat.executed) throw new Error("unreachable");
      expect(resultat.guard.decision).toBe("DENY");
      expect(appels.length).toBe(0);
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }
  });

  test("APPROVAL_REQUIRED (Guard, PENDING) — l'adapter n'est JAMAIS invoqué", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const correlationId = nouveauCorrelationId();
    const demande = await creerDemandeAutorisation({
      correlationId,
      agentId,
      action: "PROPOSE",
      scope: "TALENT",
      objective: "Test B26 — PENDING",
      reason: "Test B26 — PENDING",
      requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
    });
    if (!demande.ok) throw new Error(demande.erreur);
    expect(demande.status).toBe("PENDING");

    const { adapter, appels } = compteurAdapter();
    const resultat = await executerActionControlee(
      { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId: demande.id, correlationId },
      adapter
    );
    expect(resultat.executed).toBe(false);
    if (resultat.executed) throw new Error("unreachable");
    expect(resultat.guard.decision).toBe("APPROVAL_REQUIRED");
    expect(appels.length).toBe(0);
  });

  test("SÉCURITÉ (IDOR/BOLA hérité du Guard) — authorizationRequestId incohérent avec le contexte déclaré -> DENY, adapter jamais invoqué", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId } = await demandeApprouveeAutomatiquement(agentId);

    const { adapter, appels } = compteurAdapter();
    const resultat = await executerActionControlee(
      {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        authorizationRequestId,
        correlationId: nouveauCorrelationId(), // jamais celui du dossier réel
      },
      adapter
    );
    expect(resultat.executed).toBe(false);
    if (resultat.executed) throw new Error("unreachable");
    expect(resultat.guard.decision).toBe("DENY");
    expect(appels.length).toBe(0);
  });

  test("Emergency Stop actif — l'adapter n'est JAMAIS invoqué, même pour une AuthorizationRequest déjà ALLOW", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const arretRes = await activerArretUrgence({
      correlationId: nouveauCorrelationId(),
      scope: "GLOBAL",
      reason: "Test B26 — Emergency Stop",
      activatedBy: "admin-demo@example.com",
    });
    if (!arretRes.ok) throw new Error("unreachable");

    const { adapter, appels } = compteurAdapter();
    try {
      const resultat = await executerActionControlee(
        { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId },
        adapter
      );
      expect(resultat.executed).toBe(false);
      if (resultat.executed) throw new Error("unreachable");
      expect(resultat.guard.decision).toBe("DENY");
      expect(appels.length).toBe(0);
    } finally {
      await leverArretUrgence({ emergencyStopId: arretRes.id, liftedBy: "admin-demo@example.com" });
    }
  });

  test("ALLOW mais l'adapter échoue (ok:false) — tracé comme execute:FAILURE, jamais masqué en succès", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const adapter: ActionAdapter = async () => ({ ok: false, detail: "Échec simulé de l'adapter (fixture de test B26)." });
    const resultat = await executerActionControlee(
      { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId },
      adapter
    );
    expect(resultat.executed).toBe(true);
    if (!resultat.executed) throw new Error("unreachable");
    expect(resultat.resultat.ok).toBe(false);

    const evenements = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "execute:FAILURE" },
    });
    expect(evenements.length).toBeGreaterThan(0);
  });

  test("ALLOW mais l'adapter lève une exception — capturée, jamais propagée, tracée comme execute:FAILURE", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const adapter: ActionAdapter = async () => {
      throw new Error("Exception simulée de l'adapter (fixture de test B26).");
    };

    const resultat = await executerActionControlee(
      { agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId },
      adapter
    );
    expect(resultat.executed).toBe(true);
    if (!resultat.executed) throw new Error("unreachable");
    expect(resultat.resultat.ok).toBe(false);
    expect(resultat.resultat.detail).toContain("Exception simulée");

    const evenements = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "execute:FAILURE" },
    });
    expect(evenements.length).toBeGreaterThan(0);
  });

  test("NON-MUTATION (hors adapter) — un appel ALLOW n'écrit que l'AuditEvent Guard + l'AuditEvent d'exécution, jamais AuthorizationRequest/AgentIdentity/AgentPermission", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { authorizationRequestId, correlationId } = await demandeApprouveeAutomatiquement(agentId);

    const avant = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    const { adapter } = compteurAdapter();
    await executerActionControlee({ agentId, action: "PROPOSE", scope: "TALENT", authorizationRequestId, correlationId }, adapter);
    const apres = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });

    expect(apres).toEqual(avant);
  });
});
