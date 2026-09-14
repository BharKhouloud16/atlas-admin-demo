import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import {
  enregistrerSignalStrategique,
  enregistrerAnalyseStrategique,
  enregistrerRecommandationStrategique,
} from "@/lib/strategic/veille";
import { creerPropositionAction, autoriserProposition } from "@/lib/strategic/propositions";
import { creerDemandeAutorisation } from "@/lib/control-plane/authorization";

// COMPANY ATLAS — B24 Lot A (14/09/2026) : tests SCHÉMA UNIQUEMENT pour
// StrategicAuthorizationLink (design verrouillé B24 Phase 2 / 2.1 / 2.2 —
// audit read-only, aucune décision métier prise par le code). Ce fichier
// n'exerce AUCUN comportement applicatif nouveau : aucune route créée,
// aucun service B21/B22/B23 modifié. Les StrategicActionProposal et
// AuthorizationRequest nécessaires sont créées via les mécanismes
// EXISTANTS et inchangés (creerPropositionAction, creerDemandeAutorisation,
// lib/strategic/veille.ts) — jamais par un nouveau chemin B21 -> B22 (qui
// n'existe pas encore, Lot B).

// agent-atlas-talent possède PROPOSE/TALENT ACTIVE de façon permanente
// depuis la migration 20260913010000_b21_1_strategic_hardening (seed
// déterministe B21.1/M1) — réutilisé tel quel, aucune permission créée par
// ce fichier de test.
const AGENT_ATLAS_TALENT = "agent-atlas-talent";

async function creerPropositionDeTest(): Promise<{ proposalId: string; correlationId: string }> {
  const signalId = await enregistrerSignalStrategique({
    categorie: "OPERATIONS",
    source: "Test B24 Lot A — schéma StrategicAuthorizationLink",
    titre: "Signal de test B24 Lot A",
  });
  if (!signalId) throw new Error("échec de création du signal de test");
  const signal = await prisma.strategicSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error("signal de test introuvable après création");

  const analysisId = await enregistrerAnalyseStrategique({
    correlationId: signal.correlationId,
    signalId,
    constat: "Constat de test B24 Lot A",
  });
  if (!analysisId) throw new Error("échec de création de l'analyse de test");

  const recommendationId = await enregistrerRecommandationStrategique({
    analysisId,
    correlationId: signal.correlationId,
    recommandation: "Recommandation de test B24 Lot A",
    priorite: "P3_MONITOR",
  });
  if (!recommendationId) throw new Error("échec de création de la recommandation de test");

  const proposalId = await creerPropositionAction({
    correlationId: signal.correlationId,
    recommendationId,
    agentId: AGENT_ATLAS_TALENT,
    actionProposee: "Action de test B24 Lot A",
  });
  if (!proposalId) throw new Error("échec de création de la proposition de test");

  return { proposalId, correlationId: signal.correlationId };
}

async function creerAuthorizationRequestDeTest(correlationId: string): Promise<string> {
  const resultat = await creerDemandeAutorisation({
    correlationId,
    agentId: AGENT_ATLAS_TALENT,
    action: "PROPOSE",
    scope: "TALENT",
    objective: "Objectif de test B24 Lot A",
    reason: "Raison de test B24 Lot A",
    requestedAutonomyLevel: "L0_OBSERVE",
  });
  if (!resultat.ok) throw new Error(`échec de création de l'AuthorizationRequest de test : ${resultat.erreur}`);
  return resultat.id;
}

test.describe("COMPANY ATLAS B24 Lot A — StrategicAuthorizationLink (schéma uniquement)", () => {
  test("Test 1 — une proposition peut avoir plusieurs StrategicAuthorizationLink (cardinalité 1 → N)", async () => {
    const { proposalId, correlationId } = await creerPropositionDeTest();
    const requestId1 = await creerAuthorizationRequestDeTest(correlationId);
    const requestId2 = await creerAuthorizationRequestDeTest(correlationId);

    await prisma.strategicAuthorizationLink.create({
      data: { correlationId, proposalId, authorizationRequestId: requestId1 },
    });
    await prisma.strategicAuthorizationLink.create({
      data: { correlationId, proposalId, authorizationRequestId: requestId2 },
    });

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(2);
    expect(liens.map((l) => l.authorizationRequestId).sort()).toEqual([requestId1, requestId2].sort());
  });

  test("Test 2 — un même authorizationRequestId ne peut pas être lié deux fois (contrainte @@unique)", async () => {
    const { proposalId, correlationId } = await creerPropositionDeTest();
    const requestId = await creerAuthorizationRequestDeTest(correlationId);

    await prisma.strategicAuthorizationLink.create({
      data: { correlationId, proposalId, authorizationRequestId: requestId },
    });

    let aEchoue = false;
    try {
      await prisma.strategicAuthorizationLink.create({
        data: { correlationId, proposalId, authorizationRequestId: requestId },
      });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "un deuxième lien vers le même authorizationRequestId doit être rejeté par la contrainte unique").toBe(true);
  });

  test("Test 3 — deux propositions différentes ne peuvent pas référencer le même authorizationRequestId", async () => {
    const { proposalId: proposalId1, correlationId: correlationId1 } = await creerPropositionDeTest();
    const { proposalId: proposalId2 } = await creerPropositionDeTest();
    const requestId = await creerAuthorizationRequestDeTest(correlationId1);

    await prisma.strategicAuthorizationLink.create({
      data: { correlationId: correlationId1, proposalId: proposalId1, authorizationRequestId: requestId },
    });

    let aEchoue = false;
    try {
      await prisma.strategicAuthorizationLink.create({
        data: { correlationId: correlationId1, proposalId: proposalId2, authorizationRequestId: requestId },
      });
    } catch {
      aEchoue = true;
    }
    expect(
      aEchoue,
      "une deuxième proposition ne doit jamais pouvoir réclamer l'AuthorizationRequest d'une autre (protection contre un lien frauduleux)"
    ).toBe(true);
  });

  test("Test 4 — les liens d'une même proposition peuvent référencer des AuthorizationRequest différentes", async () => {
    const { proposalId, correlationId } = await creerPropositionDeTest();
    const requestId1 = await creerAuthorizationRequestDeTest(correlationId);
    const requestId2 = await creerAuthorizationRequestDeTest(correlationId);
    expect(requestId1).not.toBe(requestId2);

    await prisma.strategicAuthorizationLink.create({
      data: { correlationId, proposalId, authorizationRequestId: requestId1 },
    });
    await prisma.strategicAuthorizationLink.create({
      data: { correlationId, proposalId, authorizationRequestId: requestId2 },
    });

    const liens = await prisma.strategicAuthorizationLink.findMany({
      where: { proposalId },
      orderBy: { createdAt: "asc" },
    });
    expect(liens.length).toBe(2);
    expect(new Set(liens.map((l) => l.authorizationRequestId)).size).toBe(2);
  });

  test("Test 5 — AuditObjectType.STRATEGIC_ACTION_PROPOSAL est disponible (valeur d'enum seule — aucun code n'émet encore cet AuditEvent)", async () => {
    const { proposalId, correlationId } = await creerPropositionDeTest();

    const event = await prisma.auditEvent.create({
      data: {
        correlationId,
        objectType: "STRATEGIC_ACTION_PROPOSAL",
        objectId: proposalId,
        action: "test-b24-lot-a-schema-only",
        actor: "system",
      },
    });
    expect(event.objectType).toBe("STRATEGIC_ACTION_PROPOSAL");

    // Nettoyage — ce test vérifie que la valeur d'enum existe et est
    // utilisable, pas qu'un AuditEvent permanent doit exister : aucun code
    // applicatif n'émet encore cet objectType dans ce lot (schéma seul).
    await prisma.auditEvent.delete({ where: { id: event.id } });
  });

  test("Test 6 — aucune régression de comportement B21/B22 : autoriserProposition (B21) et creerDemandeAutorisation (B22) restent totalement indépendants et inchangés", async () => {
    const { proposalId, correlationId } = await creerPropositionDeTest();

    // B21 : le chemin d'écriture directe StrategicAuthorization reste
    // intact — Lot A ne l'a ni modifié ni câblé à StrategicAuthorizationLink.
    const resultat = await autoriserProposition({
      proposalId,
      autorisateurEmail: "admin-demo@example.com",
      scope: "test-b24-lot-a",
      duree: "1 jour",
    });
    expect(resultat.ok).toBe(true);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("AUTORISEE");

    // Zéro StrategicAuthorizationLink créé implicitement par ce chemin B21
    // — les deux mécanismes restent non couplés dans ce lot (aucun
    // comportement applicatif nouveau, conformément au périmètre Lot A).
    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(0);

    // B22 : creerDemandeAutorisation continue de fonctionner à l'identique,
    // sans aucune connaissance de StrategicAuthorizationLink ni de B21.
    const requestId = await creerAuthorizationRequestDeTest(correlationId);
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: requestId } });
    expect(demande?.agentId).toBe(AGENT_ATLAS_TALENT);
  });
});
