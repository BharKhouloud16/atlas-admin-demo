import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A29 : Financial Result Foundation (05/10/2026).
//
// Couvre les scénarios obligatoires du mandat A29 §45-48 : modèle,
// Revenue/Cost connus/inconnus/zéro, Profit/Loss/Break-even/
// NOT_DETERMINABLE, Margin (dont division par zéro impossible),
// provenance (DECLARE/VERIFIE + justification obligatoire), snapshot
// (immuabilité face à une mutation ultérieure de Mission.tjmVente/
// margeCible), lifecycle (DRAFT/FINALIZED sur EN_COURS/TERMINEE/
// ANNULEE), indépendance totale Outcome/Quality, immutabilité post-
// finalisation, RBAC (ADMIN seul, jamais INGENIEUR ni CLIENT), IDOR,
// concurrence, et les deux tests critiques explicitement mandatés : la
// non-invention d'un coût/profit (§46) et la non-confusion cible/réalisé
// (§47).
//
// DÉCISION DE MODÉLISATION (voir prisma/schema.prisma pour le détail
// complet) : Revenue ET Cost sont tous deux des montants DÉCLARÉS par un
// ADMIN (aucune donnée de coût Talent réellement payé n'existe dans ce
// schéma — contrat A29 §16) ; aucune contrainte "un seul résultat
// courant" par Mission (contrat A29 §35) — supersedesId reste
// explicite, jamais auto-détecté.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Reutilise la session deja authentifiee une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId — voir prisma/seed.ts");
  return user.profilId;
}

async function creerMission(
  statut: StatutMission = StatutMission.EN_COURS,
  overrides: { tjmVente?: number; nbJours?: number; margeCible?: number; deviseVente?: string } = {}
) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: {
      clientId: client.id,
      profilId,
      repere: `Test A29 ${suffixe}`,
      nbJours: overrides.nbJours ?? 20,
      tjmVente: overrides.tjmVente ?? 800,
      margeCible: overrides.margeCible ?? 0.3,
      deviseVente: overrides.deviseVente ?? "EUR",
      statut,
    },
  });
}

async function postFinancialResult(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/financial-results`, { data });
}

async function getFinancialResult(request: APIRequestContext, missionId: string, resultId: string) {
  return request.get(`/api/missions/${missionId}/financial-results/${resultId}`);
}

async function patchFinancialResult(request: APIRequestContext, missionId: string, resultId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/financial-results/${resultId}`, { data });
}

async function creerResultatViaApi(request: APIRequestContext, missionId: string, overrides: Record<string, unknown> = {}) {
  request = await connecter("ADMIN");
  const reponse = await postFinancialResult(request, missionId, {
    revenueAmount: 16000,
    revenueProvenance: "DECLARE",
    revenueJustification: "Facturation réelle du mois.",
    costAmount: 11200,
    costProvenance: "DECLARE",
    costJustification: "Coût Talent déclaré par l'Admin.",
    ...overrides,
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

test.describe("A29 — Modèle", () => {
  test("1/2. création valide -> 201, Mission correcte", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, {
      revenueAmount: 16000,
      revenueProvenance: "DECLARE",
      revenueJustification: "Facturation réelle.",
      costAmount: 11200,
      costProvenance: "DECLARE",
      costJustification: "Coût déclaré.",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.missionId).toBe(mission.id);
    expect(corps.statut).toBe("DRAFT");
  });

  test("3. montant monétaire correct (Decimal, 2 décimales)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, {
      revenueAmount: 16000.456,
      revenueProvenance: "DECLARE",
      revenueJustification: "x",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(Number(corps.revenueAmount)).toBe(16000.46);
  });

  test("4. devise correcte (snapshot depuis Mission.deviseVente si non fournie)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS, { deviseVente: "USD" });
    const reponse = await postFinancialResult(request, mission.id, {});
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.currency).toBe("USD");
  });

  test("5. provenance conservée (revenueProvenance/costProvenance stockés)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id);
    expect(corps.revenueProvenance).toBe("DECLARE");
    expect(corps.costProvenance).toBe("DECLARE");
  });

  test("6. date correcte (calculatedAt renseigné)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id);
    expect(corps.calculatedAt).toBeTruthy();
    expect(corps.calculatedByEmail).toBe("admin-demo@example.com");
  });
});

test.describe("A29 — Revenue", () => {
  test("7. revenue connu -> stocké tel quel", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 16000, revenueProvenance: "DECLARE", revenueJustification: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect(Number((await reponse.json()).revenueAmount)).toBe(16000);
  });

  test("8. revenue inconnu (absent) -> null, jamais 0", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, {});
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).revenueAmount).toBeNull();
  });

  test("9. revenue = 0 déclaré explicitement -> 0 connu, distinct d'inconnu", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 0, revenueProvenance: "DECLARE", revenueJustification: "Mission annulée avant toute facturation." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.revenueAmount).not.toBeNull();
    expect(Number(corps.revenueAmount)).toBe(0);
  });
});

test.describe("A29 — Cost", () => {
  test("10. cost connu -> stocké tel quel", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { costAmount: 11200, costProvenance: "DECLARE", costJustification: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect(Number((await reponse.json()).costAmount)).toBe(11200);
  });

  test("11. cost inconnu (absent) -> null, jamais 0", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 16000, revenueProvenance: "DECLARE", revenueJustification: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).costAmount).toBeNull();
  });

  test("12. cost = 0 déclaré explicitement -> 0 connu", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { costAmount: 0, costProvenance: "DECLARE", costJustification: "Aucun coût engagé." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect(Number((await reponse.json()).costAmount)).toBe(0);
  });

  test("16/46. TEST CRITIQUE DE NON-INVENTION : revenue connu + cost inconnu -> Profit NOT_DETERMINABLE, JAMAIS profit=revenue", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 16000, revenueProvenance: "DECLARE", revenueJustification: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.costAmount).toBeNull();
    expect(corps.profitAmount).toBeNull();
    expect(corps.resultatGlobal).toBe("NOT_DETERMINABLE");
    expect(corps.profitAmount).not.toBe(16000);
  });
});

test.describe("A29 — Profit", () => {
  test("13. profit calculé correctement (revenue - cost)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueAmount: 16000, costAmount: 11200 });
    expect(Number(corps.profitAmount)).toBe(4800);
    expect(corps.resultatGlobal).toBe("PROFIT");
  });

  test("14. perte calculée correctement (cost > revenue)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueAmount: 10000, costAmount: 14000 });
    expect(Number(corps.profitAmount)).toBe(-4000);
    expect(corps.resultatGlobal).toBe("LOSS");
  });

  test("15. break-even (revenue == cost)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueAmount: 10000, costAmount: 10000 });
    expect(Number(corps.profitAmount)).toBe(0);
    expect(corps.resultatGlobal).toBe("BREAK_EVEN");
  });
});

test.describe("A29 — Margin", () => {
  test("17. margin calculée (profit / revenue)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueAmount: 16000, costAmount: 11200 });
    expect(Number(corps.marginPct)).toBeCloseTo(0.3, 4);
  });

  test("18/19. revenue = 0 connu -> margin NOT_DETERMINABLE (division par zéro jamais calculée, jamais NaN/Infinity)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, {
      revenueAmount: 0,
      revenueProvenance: "DECLARE",
      revenueJustification: "Aucune facturation.",
      costAmount: 500,
      costProvenance: "DECLARE",
      costJustification: "Frais engagés malgré tout.",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.marginPct).toBeNull();
    // Profit reste déterminable (0 - 500 = -500) même si margin ne l'est pas.
    expect(Number(corps.profitAmount)).toBe(-500);
    expect(corps.resultatGlobal).toBe("LOSS");
  });

  test("20. rounding déterministe (4 décimales, ROUND_HALF_UP)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueAmount: 3, costAmount: 2 });
    // (3-2)/3 = 0.333333... -> arrondi à 0.3333
    expect(corps.marginPct).toBe("0.3333");
  });
});

test.describe("A29 — Provenance", () => {
  test("21. DECLARE accepté", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, { revenueProvenance: "DECLARE" });
    expect(corps.revenueProvenance).toBe("DECLARE");
  });

  test("22. VERIFIE accepté (provenance distincte, jamais une donnée simplement saisie qualifiée verified par défaut)", async ({ request }) => {
    const corps = await creerResultatViaApi(request, (await creerMission()).id, {
      revenueProvenance: "VERIFIE",
      revenueJustification: "Vérifié contre Facture/Paiement réellement encaissés ce mois.",
    });
    expect(corps.revenueProvenance).toBe("VERIFIE");
  });

  test("23. montant sans provenance -> 400, jamais stocké sans savoir d'où il vient", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 16000 });
    expect(reponse.status()).toBe(400);
  });

  test("24. montant avec provenance mais sans justification -> 400, calcul explicable exigé", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postFinancialResult(request, mission.id, { revenueAmount: 16000, revenueProvenance: "DECLARE" });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("A29 — Snapshot", () => {
  test("25/26/27. modification Mission.tjmVente/margeCible APRÈS création -> Financial Result historique inchangé", async ({ request }) => {
    const mission = await creerMission(StatutMission.EN_COURS, { tjmVente: 800, margeCible: 0.3 });
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 16000, costAmount: 11200 });

    await prisma.mission.update({ where: { id: mission.id }, data: { tjmVente: 1500, margeCible: 0.5 } });

    const rechargee = await prisma.financialResult.findUnique({ where: { id: corps.id } });
    expect(rechargee?.revenueAmount?.toNumber()).toBe(16000);
    expect(rechargee?.costAmount?.toNumber()).toBe(11200);
    expect(rechargee?.profitAmount?.toNumber()).toBe(4800);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.tjmVente).toBe(1500);
    expect(missionApres?.margeCible).toBe(0.5);
  });

  test("47. CIBLE COMMERCIALE != RÉALISÉ : sans déclaration Admin, aucun Financial Result n'est auto-calculé depuis tjmVente*nbJours", async () => {
    // Mission.tjmVente=800 * nbJours=20 = 16000 (la CIBLE commerciale) —
    // une création sans revenueAmount/costAmount explicites ne doit
    // JAMAIS produire ce montant par magie : elle reste null/
    // NOT_DETERMINABLE, jamais 16000.
    const mission = await creerMission(StatutMission.EN_COURS, { tjmVente: 800, nbJours: 20, margeCible: 0.3 });
    let request = await connecter("ADMIN");
    const sansDeclaration = await postFinancialResult(request, mission.id, {});
    expect(sansDeclaration.status(), await sansDeclaration.text()).toBe(201);
    const corpsSansDeclaration = await sansDeclaration.json();
    expect(corpsSansDeclaration.revenueAmount).toBeNull();
    expect(corpsSansDeclaration.costAmount).toBeNull();
    expect(corpsSansDeclaration.resultatGlobal).toBe("NOT_DETERMINABLE");
  });
});

test.describe("A29 — Lifecycle", () => {
  test("28. Mission EN_COURS : Financial Result DRAFT autorisé", async ({ request }) => {
    const mission = await creerMission(StatutMission.EN_COURS);
    const corps = await creerResultatViaApi(request, mission.id);
    expect(corps.statut).toBe("DRAFT");
  });

  test("29. Mission TERMINEE : création et finalisation autorisées", async ({ request }) => {
    const mission = await creerMission(StatutMission.TERMINEE);
    const corps = await creerResultatViaApi(request, mission.id);
    const finalisation = await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" });
    expect(finalisation.status(), await finalisation.text()).toBe(200);
    expect((await finalisation.json()).statut).toBe("FINALIZED");
  });

  test("30. Mission ANNULEE : résultat financier toujours pertinent, aucune réouverture de Mission", async ({ request }) => {
    const mission = await creerMission(StatutMission.ANNULEE);
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 5000, costAmount: 7000 });
    expect(Number(corps.profitAmount)).toBe(-2000);
    expect(corps.resultatGlobal).toBe("LOSS");

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("ANNULEE");
  });
});

test.describe("A29 — Independence (Outcome/Quality)", () => {
  test("31/48. Outcome ACHIEVED (OBTENU) + Financial Result LOSS -> les deux coexistent sans contrainte croisée", async ({ request }) => {
    const mission = await creerMission(StatutMission.TERMINEE);
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 5000, costAmount: 9000 });
    expect(corps.resultatGlobal).toBe("LOSS");

    const outcome = await prisma.outcomeAssessment.create({
      data: { missionId: mission.id, overallStatus: "OBTENU", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
    });
    expect(outcome.overallStatus).toBe("OBTENU");
  });

  test("32/48. Outcome NOT_ACHIEVED (NON_OBTENU) + Financial Result PROFIT -> les deux coexistent sans contrainte croisée", async ({ request }) => {
    const mission = await creerMission(StatutMission.TERMINEE);
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 20000, costAmount: 5000 });
    expect(corps.resultatGlobal).toBe("PROFIT");

    const outcome = await prisma.outcomeAssessment.create({
      data: { missionId: mission.id, overallStatus: "NON_OBTENU", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
    });
    expect(outcome.overallStatus).toBe("NON_OBTENU");
  });

  test("33. Quality PASS + Financial Result LOSS -> les deux coexistent sans contrainte croisée", async ({ request }) => {
    const mission = await creerMission();
    const deliverable = await prisma.deliverable.create({
      data: { missionId: mission.id, createdByEmail: "admin-demo@example.com", versions: { create: { version: 1, titre: "Livrable", natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } } },
      include: { versions: true },
    });
    const quality = await prisma.deliveryQualityGate.create({
      data: { deliverableVersionId: deliverable.versions[0].id, criteresEvalues: "x", resultat: "PASS", evaluatedByEmail: "admin-demo@example.com", evaluatedByRole: "ADMIN", createdByEmail: "admin-demo@example.com" },
    });
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 1000, costAmount: 3000 });
    expect(quality.resultat).toBe("PASS");
    expect(corps.resultatGlobal).toBe("LOSS");
  });

  test("34. Quality FAIL + Financial Result PROFIT -> les deux coexistent sans contrainte croisée", async ({ request }) => {
    const mission = await creerMission();
    const deliverable = await prisma.deliverable.create({
      data: { missionId: mission.id, createdByEmail: "admin-demo@example.com", versions: { create: { version: 1, titre: "Livrable", natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } } },
      include: { versions: true },
    });
    const quality = await prisma.deliveryQualityGate.create({
      data: { deliverableVersionId: deliverable.versions[0].id, criteresEvalues: "x", resultat: "FAIL", evaluatedByEmail: "admin-demo@example.com", evaluatedByRole: "ADMIN", createdByEmail: "admin-demo@example.com" },
    });
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 20000, costAmount: 5000 });
    expect(quality.resultat).toBe("FAIL");
    expect(corps.resultatGlobal).toBe("PROFIT");
  });
});

test.describe("A29 — Immutabilité", () => {
  test("35. finalisation DRAFT -> FINALIZED -> 200", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);
    const finalisation = await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" });
    expect(finalisation.status(), await finalisation.text()).toBe(200);
  });

  test("36. mutation après finalisation refusée (409), contenu inchangé", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id, { revenueAmount: 16000, costAmount: 11200 });
    await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" });

    const tentative = await patchFinancialResult(request, mission.id, corps.id, { costAmount: 99999, costProvenance: "DECLARE", costJustification: "x" });
    expect(tentative.status()).toBe(409);

    const rechargee = await prisma.financialResult.findUnique({ where: { id: corps.id } });
    expect(rechargee?.costAmount?.toNumber()).toBe(11200);
  });

  test("37. correction historique : nouvelle ligne supersède l'ancienne, jamais une réécriture", async ({ request }) => {
    const mission = await creerMission();
    const corps1 = await creerResultatViaApi(request, mission.id, { revenueAmount: 16000, costAmount: 11200 });
    await patchFinancialResult(request, mission.id, corps1.id, { action: "finaliser" });

    const corps2 = await creerResultatViaApi(request, mission.id, { revenueAmount: 16000, costAmount: 12000, supersedesId: corps1.id });
    expect(corps2.supersedesId).toBe(corps1.id);

    const corps1Rechargee = await prisma.financialResult.findUnique({ where: { id: corps1.id } });
    expect(corps1Rechargee?.costAmount?.toNumber()).toBe(11200); // jamais réécrite
    expect(corps1Rechargee?.statut).toBe("FINALIZED");
  });
});

test.describe("A29 — RBAC", () => {
  test("38. ADMIN : création, lecture, finalisation -> OK", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);
    const lecture = await getFinancialResult(request, mission.id, corps.id);
    expect(lecture.status()).toBe(200);
    const finalisation = await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" });
    expect(finalisation.status()).toBe(200);
  });

  test("39. INGENIEUR : aucun accès, même sur sa propre Mission (conflit d'intérêt, jamais une auto-certification)", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);

    request = await connecter("INGENIEUR");
    expect((await postFinancialResult(request, mission.id, { revenueAmount: 1, revenueProvenance: "DECLARE", revenueJustification: "x" })).status()).toBe(403);
    expect((await getFinancialResult(request, mission.id, corps.id)).status()).toBe(403);
    expect((await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" })).status()).toBe(403);
  });

  test("40. CLIENT : aucun accès (donnée interne Atlas, jamais tarifaire côté Client)", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);

    request = await connecter("CLIENT");
    expect((await postFinancialResult(request, mission.id, { revenueAmount: 1, revenueProvenance: "DECLARE", revenueJustification: "x" })).status()).toBe(403);
    expect((await getFinancialResult(request, mission.id, corps.id)).status()).toBe(403);
    expect((await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" })).status()).toBe(403);
  });
});

test.describe("A29 — IDOR", () => {
  test("41. FinancialResult d'une autre Mission -> 404", async ({ request }) => {
    const missionA = await creerMission();
    const missionB = await creerMission();
    const corpsB = await creerResultatViaApi(request, missionB.id);

    const reponse = await getFinancialResult(request, missionA.id, corpsB.id);
    expect(reponse.status()).toBe(404);
  });

  test("42. Mission introuvable -> 404", async () => {
    let request = await connecter("ADMIN");
    const reponse = await postFinancialResult(request, "mission-inexistante-123", { revenueAmount: 1, revenueProvenance: "DECLARE", revenueJustification: "x" });
    expect(reponse.status()).toBe(404);
  });

  test("supersedesId d'une autre Mission -> 404 (jamais une fuite d'existence)", async ({ request }) => {
    const missionA = await creerMission();
    const missionB = await creerMission();
    const corpsB = await creerResultatViaApi(request, missionB.id);

    request = await connecter("ADMIN");
    const reponse = await postFinancialResult(request, missionA.id, { supersedesId: corpsB.id });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A29 — Concurrence", () => {
  test("43. double finalisation simultanée -> une seule gagne, jamais un état impossible", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);

    const [r1, r2] = await Promise.all([
      patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" }),
      patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const rechargee = await prisma.financialResult.findUnique({ where: { id: corps.id } });
    expect(rechargee?.statut).toBe("FINALIZED");
  });

  test("44. double création simultanée sur la même Mission -> toutes deux autorisées (aucun invariant croisé, contrat A29 §35)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();

    const [r1, r2] = await Promise.all([
      postFinancialResult(request, mission.id, { revenueAmount: 1000, revenueProvenance: "DECLARE", revenueJustification: "Évaluation A" }),
      postFinancialResult(request, mission.id, { revenueAmount: 2000, revenueProvenance: "DECLARE", revenueJustification: "Évaluation B" }),
    ]);
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);

    const total = await prisma.financialResult.count({ where: { missionId: mission.id } });
    expect(total).toBe(2);
  });
});

test.describe("A29 — Journalisation", () => {
  test("création -> journal financial_result.created", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);
    const entree = await prisma.journalActivite.findFirst({ where: { action: "financial_result.created", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
    expect(entree!.detail).toContain(corps.id);
  });

  test("finalisation -> journal financial_result.finalized", async ({ request }) => {
    const mission = await creerMission();
    const corps = await creerResultatViaApi(request, mission.id);
    await patchFinancialResult(request, mission.id, corps.id, { action: "finaliser" });
    const entree = await prisma.journalActivite.findFirst({ where: { action: "financial_result.finalized", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
  });

  test("correction -> journal financial_result.superseded", async ({ request }) => {
    const mission = await creerMission();
    const corps1 = await creerResultatViaApi(request, mission.id);
    await creerResultatViaApi(request, mission.id, { supersedesId: corps1.id });
    const entree = await prisma.journalActivite.findFirst({ where: { action: "financial_result.superseded", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
  });
});
