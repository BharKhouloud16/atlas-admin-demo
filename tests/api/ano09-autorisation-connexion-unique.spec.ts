import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { demanderAutorisationStrategique } from "@/lib/strategic/authorization-request";
import { creerPropositionAction } from "@/lib/strategic/propositions";
import { enregistrerSignalStrategique, enregistrerAnalyseStrategique, enregistrerRecommandationStrategique } from "@/lib/strategic/veille";

// ANO-09 (01/11/2026) — demande d'autorisation stratégique (B24 → B22) avec
// UNE SEULE connexion (connection_limit=1 en Preview). Avant correction,
// l'appel B22 attendait une seconde connexion pendant que la transaction
// tenait la seule disponible : transaction « idle in transaction » sans fin,
// serveur bloqué. Ces tests s'exécutent avec le pool de la suite
// (LOCAL_PG_POOL_MAX, 1 en conditions Preview) et SANS délai
// idle_in_transaction côté base : un blocage les ferait échouer, jamais
// passer. Données isolées : une proposition neuve par test.

async function propositionIsolee(): Promise<{ proposalId: string; correlationId: string }> {
  const agent = await prisma.agentIdentity.findFirst({ where: { agent: "ATLAS_TALENT" as never } });
  if (!agent) throw new Error("agent ATLAS_TALENT introuvable");
  const signalId = await enregistrerSignalStrategique({ categorie: "OPERATIONS", source: "test ANO-09", titre: "Signal de test ANO-09" });
  if (!signalId) throw new Error("signal non créé");
  const signal = await prisma.strategicSignal.findUniqueOrThrow({ where: { id: signalId } });
  const analysisId = await enregistrerAnalyseStrategique({ correlationId: signal.correlationId, signalId, constat: "Constat de test ANO-09" });
  if (!analysisId) throw new Error("analyse non créée");
  const recommendationId = await enregistrerRecommandationStrategique({ analysisId, correlationId: signal.correlationId, recommandation: "Recommandation de test ANO-09", priorite: "P3_MONITOR" });
  if (!recommendationId) throw new Error("recommandation non créée");
  const proposalId = await creerPropositionAction({ correlationId: signal.correlationId, recommendationId, agentId: agent.id, actionProposee: "Action de test ANO-09" });
  if (!proposalId) throw new Error("proposition non créée");
  return { proposalId, correlationId: signal.correlationId };
}

async function transactionsOuvertes(): Promise<number> {
  const lignes = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_stat_activity
    WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`;
  return Number(lignes[0].n);
}

function avantDelai<T>(promesse: Promise<T>, ms: number, quoi: string): Promise<T> {
  return Promise.race([promesse, new Promise<T>((_, rejeter) => setTimeout(() => rejeter(new Error(`${quoi} : bloqué plus de ${ms} ms`)), ms))]);
}

test("ANO-09 — appel direct : la demande aboutit sans attendre une seconde connexion, aucune transaction laissée ouverte", async () => {
  const { proposalId } = await propositionIsolee();
  const resultat = await avantDelai(
    demanderAutorisationStrategique({ proposalId, action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" }),
    8_000,
    "demanderAutorisationStrategique"
  );
  expect(resultat.ok, JSON.stringify(resultat)).toBe(true);
  if (!resultat.ok) throw new Error("unreachable");
  expect(resultat.status).toBe("PENDING");
  const lien = await prisma.strategicAuthorizationLink.findUniqueOrThrow({ where: { id: resultat.linkId } });
  expect(lien.proposalId).toBe(proposalId);
  expect(await transactionsOuvertes()).toBe(0);
});

test("ANO-09 — route HTTP : réponse rapide et serveur toujours disponible juste après", async ({ request }) => {
  const connexion = await request.post("/api/auth/login", { data: { email: "admin-demo@example.com", password: "Demo1234" } });
  expect(connexion.ok()).toBeTruthy();
  const { proposalId } = await propositionIsolee();
  const debut = Date.now();
  const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
    data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    timeout: 8_000,
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  expect(Date.now() - debut).toBeLessThan(8_000);
  // Le serveur (même connexion unique) répond encore à une autre requête.
  const autre = await request.get("/api/security/agents", { timeout: 5_000 });
  expect(autre.ok()).toBeTruthy();
  expect(await transactionsOuvertes()).toBe(0);
});

test("ANO-09 — six demandes simultanées sur la même proposition : une seule aboutit, aucun second PENDING, demandes refusées révoquées", async () => {
  const { proposalId, correlationId } = await propositionIsolee();
  const resultats = await avantDelai(
    Promise.all(
      Array.from({ length: 6 }, () =>
        demanderAutorisationStrategique({ proposalId, action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" })
      )
    ),
    20_000,
    "6 demandes simultanées"
  );
  const reussies = resultats.filter((r) => r.ok);
  expect(reussies).toHaveLength(1);
  for (const r of resultats.filter((x) => !x.ok)) {
    if (r.ok) continue;
    expect(r.code, r.erreur).toBe(409);
    expect(r.erreur).toContain("PENDING");
  }
  const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
  expect(liens).toHaveLength(1);
  // Invariant : une seule demande PENDING pour cette proposition, celle du
  // lien. Toute autre demande créée par B22 pendant la course est REVOKED.
  const demandes = await prisma.authorizationRequest.findMany({ where: { correlationId } });
  const pending = demandes.filter((d) => d.status === "PENDING");
  expect(pending.map((d) => d.id)).toEqual([liens[0].authorizationRequestId]);
  for (const d of demandes.filter((x) => x.id !== liens[0].authorizationRequestId)) {
    expect(d.status, `demande ${d.id}`).toBe("REVOKED");
  }
  test.info().annotations.push({ type: "course", description: `${demandes.length - 1} demande(s) créée(s) puis révoquée(s) pendant la course` });
  expect(await transactionsOuvertes()).toBe(0);
});
