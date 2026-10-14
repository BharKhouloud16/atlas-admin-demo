import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { estIngenieurAutoriseSurMission } from "@/lib/delivery-evidence/access";
import { construireDecisionContext, DecisionEntityIntrouvableError } from "@/lib/decision-context/context";
import { rechercherLearningsPertinents } from "@/lib/decision-context/retrieval";
import { detecterConflitsDecision } from "@/lib/decision-context/conflicts";
import { construireContexteDecisionnel, determinerStatus } from "@/lib/decision-context";

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Couvre exactement le contrat A36.1 : construction du DecisionContext
// (NEED/QUALIFICATION/SOLUTION/MISSION), retrieval déterministe
// (statut=VALIDE AND applicabilite=ACTIVE, scopes MISSION/CLIENT/
// CAPABILITY/ATLAS, DOMAIN exclu), relevance DIRECT/CONTEXTUAL (sans
// score opaque), conflits BEST_PRACTICE/ANTI_PATTERN (signal, jamais un
// arbitrage), sécurité (RBAC existant réutilisé, jamais contourné),
// immutabilité stricte (lecture seule). Aucun test de ce fichier ne
// modifie lib/learning/learning.ts, lib/agentic/runtime.ts ou
// lib/learning-loop/*.ts.

function SUFFIXE() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function clientIsole() {
  return prisma.client.create({ data: { nom: `Client isolé A36 ${SUFFIXE()}` } });
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId");
  return user.profilId;
}

async function creerProfilIsole() {
  return prisma.profil.create({ data: { nom: `Talent isolé A36 ${SUFFIXE()}` } });
}

async function creerMission(clientId: string, solutionDecisionId?: string) {
  const profilId = await profilIngenieurDemo();
  return prisma.mission.create({
    data: {
      clientId,
      profilId,
      repere: `Test A36 ${SUFFIXE()}`,
      nbJours: 10,
      tjmVente: 700,
      margeCible: 0.3,
      deviseVente: "EUR",
      statut: "EN_COURS",
      solutionDecisionId: solutionDecisionId ?? null,
    },
  });
}

async function creerLienCapability(missionId: string, capability: string, statut: "ACTIVE" | "SUPERSEDED" = "ACTIVE") {
  return prisma.missionCapabilityLink.create({
    data: { missionId, capability, statut, createdByEmail: "admin-demo@example.com" },
  });
}

async function creerNeed(clientId: string) {
  return prisma.clientNeed.create({
    data: { clientId, correlationId: `a36-${SUFFIXE()}`, texteOriginal: `Besoin A36 ${SUFFIXE()}`, statut: "VALIDE" },
  });
}

async function creerCapabilityRequirement(needVersionId: string, requiredCapability: string, status: "ACTIVE" | "SUPERSEDED" = "ACTIVE") {
  return prisma.capabilityRequirement.create({
    data: {
      needVersionId,
      sourceFaitId: `fait-a36-${SUFFIXE()}`,
      requiredCapability,
      rationale: "Dérivation de test A36.",
      provenance: "DECLARE",
      status,
    },
  });
}

async function creerSolutionOption(clientId: string, needId: string, niveau: "OPTION" | "RECOMMANDATION" | "DECISION" = "OPTION") {
  return prisma.solutionOption.create({
    data: {
      clientId,
      needId,
      niveau,
      typeSolution: "TALENT",
      titre: `${niveau} de test A36`,
      justification: `${niveau} figée pour test A36.`,
      donnees: {},
      ...(niveau === "DECISION" ? { decideParEmail: "client-demo@example.com", decideLe: new Date() } : {}),
    },
  });
}

async function creerLearning(
  missionId: string,
  overrides: Partial<{
    scope: "MISSION" | "CLIENT" | "DOMAIN" | "CAPABILITY" | "ATLAS";
    type: "LESSON" | "PATTERN" | "BEST_PRACTICE" | "ANTI_PATTERN" | "RECOMMENDATION" | "INSIGHT";
    statut: "PROPOSE" | "VALIDE";
    applicabilite: "ACTIVE" | "OBSOLETE";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    provenance: "OBSERVED" | "DECLARED" | "VERIFIED" | "INFERRED";
    title: string;
    createdAt: Date;
  }> = {}
) {
  const learning = await prisma.learning.create({
    data: {
      missionId,
      type: overrides.type ?? "LESSON",
      title: overrides.title ?? `Learning A36 ${SUFFIXE()}`,
      statement: "Observation de test A36.",
      provenance: overrides.provenance ?? "OBSERVED",
      confidence: overrides.confidence ?? "MEDIUM",
      scope: overrides.scope ?? "MISSION",
      createdByEmail: "admin-demo@example.com",
      createdByRole: "ADMIN",
    },
  });
  const donnees: Record<string, unknown> = { statut: overrides.statut ?? "VALIDE", applicabilite: overrides.applicabilite ?? "ACTIVE" };
  if (overrides.createdAt) donnees.createdAt = overrides.createdAt;
  // statut/applicabilite ne sont jamais écrits à la création par le service
  // A30 (toujours PROPOSE/ACTIVE) — ici on simule directement l'état
  // "VALIDE+ACTIVE" déjà atteint (via validerLearning/marquerObsolete en
  // production) sans dupliquer ce service, puisque seule la LECTURE de
  // ces deux champs est sous test, jamais leur logique de transition
  // (hors périmètre A36.1, déjà verrouillée par A30).
  return prisma.learning.update({ where: { id: learning.id }, data: donnees });
}

test.describe("A36.1 — Context construction", () => {
  test("NEED : résout clientId + capabilityIds depuis CapabilityRequirement ACTIVE", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    await creerCapabilityRequirement(need.id, "QA-A36");
    await creerCapabilityRequirement(need.id, "CYBER-A36", "SUPERSEDED"); // jamais incluse

    const contexte = await construireDecisionContext("NEED", need.id);
    expect(contexte.clientId).toBe(client.id);
    expect(contexte.needVersionId).toBe(need.id);
    expect(contexte.capabilityIds).toEqual(["QA-A36"]);
    expect(contexte.missionId).toBeUndefined();
  });

  test("QUALIFICATION : même résolution que NEED (même entité ClientNeed)", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    await creerCapabilityRequirement(need.id, "QA-A36-QUAL");

    const contexte = await construireDecisionContext("QUALIFICATION", need.id);
    expect(contexte.clientId).toBe(client.id);
    expect(contexte.capabilityIds).toEqual(["QA-A36-QUAL"]);
  });

  test("SOLUTION (OPTION) : résout clientId + needVersionId + capabilityIds, solutionDecisionId=undefined (aucune décision)", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    await creerCapabilityRequirement(need.id, "QA-A36-SOL");
    const option = await creerSolutionOption(client.id, need.id, "OPTION");

    const contexte = await construireDecisionContext("SOLUTION", option.id);
    expect(contexte.clientId).toBe(client.id);
    expect(contexte.needVersionId).toBe(need.id);
    expect(contexte.capabilityIds).toEqual(["QA-A36-SOL"]);
    expect(contexte.decisionEntityId).toBe(option.id);
    expect(contexte.solutionDecisionId).toBeUndefined();
  });

  // A36.2.2-FIX (contrat A36.2.1) — Test A : consulter une RECOMMANDATION
  // (pas encore décidée) ne doit jamais faire croire qu'une décision
  // existe déjà.
  test("SOLUTION (RECOMMANDATION) : decisionEntityId = recommendation.id, solutionDecisionId = undefined", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    const recommendation = await creerSolutionOption(client.id, need.id, "RECOMMANDATION");

    const contexte = await construireDecisionContext("SOLUTION", recommendation.id);
    expect(contexte.decisionEntityId).toBe(recommendation.id);
    expect(contexte.solutionDecisionId).toBeUndefined();
  });

  // A36.2.2-FIX (contrat A36.2.1) — Test B : une véritable DECISION
  // renseigne solutionDecisionId avec son propre id.
  test("SOLUTION (DECISION) : decisionEntityId = decision.id, solutionDecisionId = decision.id", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    const decision = await creerSolutionOption(client.id, need.id, "DECISION");

    const contexte = await construireDecisionContext("SOLUTION", decision.id);
    expect(contexte.decisionEntityId).toBe(decision.id);
    expect(contexte.solutionDecisionId).toBe(decision.id);
  });

  test("MISSION : résout clientId + missionId + capabilityIds depuis MissionCapabilityLink ACTIVE (SUPERSEDED exclu)", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    await creerLienCapability(mission.id, "QA-A36-MISSION", "ACTIVE");
    await creerLienCapability(mission.id, "CYBER-A36-MISSION", "SUPERSEDED");

    const contexte = await construireDecisionContext("MISSION", mission.id);
    expect(contexte.clientId).toBe(client.id);
    expect(contexte.missionId).toBe(mission.id);
    expect(contexte.capabilityIds).toEqual(["QA-A36-MISSION"]);
  });

  // A36.2.2-FIX (contrat A36.2.1 §5) — Test C : le contexte MISSION expose
  // la décision Solution réellement pinnée (Mission.solutionDecisionId,
  // A18) — jamais recalculée, jamais undefined quand le pin existe.
  test("MISSION : conserve correctement solutionDecisionId depuis la décision Solution réellement pinnée", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    const decision = await creerSolutionOption(client.id, need.id, "DECISION");
    const missionPinnee = await creerMission(client.id, decision.id);
    const missionNonPinnee = await creerMission(client.id);

    const contextePinnee = await construireDecisionContext("MISSION", missionPinnee.id);
    expect(contextePinnee.solutionDecisionId).toBe(decision.id);

    const contexteNonPinnee = await construireDecisionContext("MISSION", missionNonPinnee.id);
    expect(contexteNonPinnee.solutionDecisionId).toBeUndefined();
  });

  test("entité introuvable (NEED) -> DecisionEntityIntrouvableError", async () => {
    await expect(construireDecisionContext("NEED", "need-inexistant-a36")).rejects.toThrow(DecisionEntityIntrouvableError);
  });

  test("entité introuvable (MISSION) -> DecisionEntityIntrouvableError", async () => {
    await expect(construireDecisionContext("MISSION", "mission-inexistante-a36")).rejects.toThrow(DecisionEntityIntrouvableError);
  });
});

// A36.2.2-FIX (contrat A36.2.1) — Test D/E : la correction sémantique de
// solutionDecisionId ne modifie aucun résultat de retrieval, et reste
// strictement read-only.
test.describe("A36.2.2 — Correction sémantique (solutionDecisionId)", () => {
  test("D — retrieval inchangé : rechercherLearningsPertinents() ignore solutionDecisionId", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION" });

    const contexteAvecChamp = await construireDecisionContext("MISSION", mission.id);
    const resultatsAvecChamp = await rechercherLearningsPertinents(contexteAvecChamp);
    const { solutionDecisionId: _ignore, ...contexteSansChamp } = contexteAvecChamp;
    const resultatsSansChamp = await rechercherLearningsPertinents(contexteSansChamp as typeof contexteAvecChamp);

    expect(resultatsAvecChamp.map((r) => r.learningId)).toContain(learning.id);
    expect(resultatsAvecChamp.map((r) => r.learningId)).toEqual(resultatsSansChamp.map((r) => r.learningId));
  });

  test("E — read-only : aucune écriture Mission/SolutionOption/Learning introduite par la correction", async () => {
    const client = await clientIsole();
    const need = await creerNeed(client.id);
    const decision = await creerSolutionOption(client.id, need.id, "DECISION");
    const mission = await creerMission(client.id, decision.id);

    const missionAvant = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    const decisionAvant = await prisma.solutionOption.findUniqueOrThrow({ where: { id: decision.id } });

    await construireDecisionContext("SOLUTION", decision.id);
    await construireDecisionContext("MISSION", mission.id);

    const missionApres = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    const decisionApres = await prisma.solutionOption.findUniqueOrThrow({ where: { id: decision.id } });
    expect(missionApres).toEqual(missionAvant);
    expect(decisionApres).toEqual(decisionAvant);
  });
});

test.describe("A36.1 — Retrieval (statut=VALIDE AND applicabilite=ACTIVE, scopes)", () => {
  test("PROPOSE exclu", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION", statut: "PROPOSE" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    // Note : ATLAS étant global par construction (contrat A36.1 §8),
    // d'autres Learnings ATLAS peuvent être présents (pollution attendue
    // d'autres tests/runs, jamais un défaut) — seule l'exclusion du
    // Learning PROPOSE créé ci-dessus (le fait sous test) est vérifiée.
    expect(resultats.map((r) => r.learningId)).not.toContain(learning.id);
  });

  test("OBSOLETE (applicabilite) exclu", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION", applicabilite: "OBSOLETE" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).not.toContain(learning.id);
  });

  test("VALIDE + ACTIVE inclus", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).toContain(learning.id);
  });

  test("CLIENT même Client inclus", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "CLIENT" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).toContain(learning.id);
  });

  test("CLIENT autre Client exclu", async () => {
    const clientA = await clientIsole();
    const clientB = await clientIsole();
    const missionA = await creerMission(clientA.id);
    const missionB = await creerMission(clientB.id);
    const learning = await creerLearning(missionB.id, { scope: "CLIENT" });

    const contexte = await construireDecisionContext("MISSION", missionA.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).not.toContain(learning.id);
  });

  test("CAPABILITY partagée incluse", async () => {
    const client = await clientIsole();
    const missionSource = await creerMission(client.id);
    await creerLienCapability(missionSource.id, "QA-A36-RETRIEVAL");
    const learning = await creerLearning(missionSource.id, { scope: "CAPABILITY" });

    const missionCourante = await creerMission(client.id);
    await creerLienCapability(missionCourante.id, "QA-A36-RETRIEVAL");

    const contexte = await construireDecisionContext("MISSION", missionCourante.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).toContain(learning.id);
  });

  test("CAPABILITY différente exclue", async () => {
    const client = await clientIsole();
    const missionSource = await creerMission(client.id);
    await creerLienCapability(missionSource.id, "CYBER-A36-RETRIEVAL");
    const learning = await creerLearning(missionSource.id, { scope: "CAPABILITY" });

    const missionCourante = await creerMission(client.id);
    await creerLienCapability(missionCourante.id, "QA-A36-RETRIEVAL-AUTRE");

    const contexte = await construireDecisionContext("MISSION", missionCourante.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).not.toContain(learning.id);
  });

  test("ATLAS inclus", async () => {
    const client = await clientIsole();
    const missionSource = await creerMission(client.id);
    const learning = await creerLearning(missionSource.id, { scope: "ATLAS" });

    const clientCourant = await clientIsole();
    const missionCourante = await creerMission(clientCourant.id);
    const contexte = await construireDecisionContext("MISSION", missionCourante.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).toContain(learning.id);
  });

  test("MISSION même Mission incluse", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).toContain(learning.id);
  });

  test("MISSION Mission différente exclue", async () => {
    const client = await clientIsole();
    const missionA = await creerMission(client.id);
    const missionB = await creerMission(client.id);
    const learningB = await creerLearning(missionB.id, { scope: "MISSION" });

    const contexte = await construireDecisionContext("MISSION", missionA.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    // Note : ATLAS étant global par construction, le résultat peut
    // contenir d'autres Learnings ATLAS créés par d'autres tests de ce
    // fichier (pollution attendue, jamais un défaut) — seule l'exclusion
    // du Learning MISSION de missionB (le fait réellement sous test) est
    // vérifiée ici.
    expect(resultats.map((r) => r.learningId)).not.toContain(learningB.id);
  });

  test("DOMAIN exclu (contrat A36.1 — limitation documentée, décision CTO)", async () => {
    // DOMAIN scope exists in A30 but is not structurally retrievable
    // until ATLAS introduces a domain anchor. Jamais assimilé à ATLAS.
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learningDomain = await creerLearning(mission.id, { scope: "DOMAIN" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).not.toContain(learningDomain.id);
    expect(resultats.some((r) => r.scope === "DOMAIN")).toBe(false);
  });

  test("résultat vide -> NO_RELEVANT_LEARNING (logique pure, indépendante de la pollution ATLAS globale)", () => {
    // ATLAS étant global par construction (contrat A36.1 §8), un
    // environnement partagé ne peut jamais garantir empiriquement
    // l'absence de tout Learning ATLAS VALIDE+ACTIVE — la logique de
    // statut elle-même (pure) est donc testée directement, même
    // méthodologie que determinerType()/determinerConfidence() (A35).
    expect(determinerStatus([], [])).toBe("NO_RELEVANT_LEARNING");
  });
});

test.describe("A36.1 — Relevance (DIRECT/CONTEXTUAL, sans score opaque)", () => {
  test("même Mission -> DIRECT", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    await creerLearning(mission.id, { scope: "MISSION" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const [resultat] = await rechercherLearningsPertinents(contexte);
    expect(resultat.relevance).toBe("DIRECT");
    expect(resultat.reason).toBe("Learning from the same Mission.");
  });

  test("même Client -> DIRECT", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    await creerLearning(mission.id, { scope: "CLIENT" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const [resultat] = await rechercherLearningsPertinents(contexte);
    expect(resultat.relevance).toBe("DIRECT");
    expect(resultat.reason).toBe("Learning declared at Client scope for the same Client.");
  });

  test("Capability partagée -> CONTEXTUAL", async () => {
    const client = await clientIsole();
    const missionSource = await creerMission(client.id);
    await creerLienCapability(missionSource.id, "QA-A36-REL");
    await creerLearning(missionSource.id, { scope: "CAPABILITY" });

    const missionCourante = await creerMission(client.id);
    await creerLienCapability(missionCourante.id, "QA-A36-REL");

    const contexte = await construireDecisionContext("MISSION", missionCourante.id);
    const [resultat] = await rechercherLearningsPertinents(contexte);
    expect(resultat.relevance).toBe("CONTEXTUAL");
    expect(resultat.reason).toBe("Learning associated with a shared active Capability.");
  });

  test("ATLAS -> CONTEXTUAL (jamais DIRECT, jamais une vérité)", async () => {
    const missionSource = await creerMission((await clientIsole()).id);
    await creerLearning(missionSource.id, { scope: "ATLAS" });

    const contexte = await construireDecisionContext("MISSION", (await creerMission((await clientIsole()).id)).id);
    const [resultat] = await rechercherLearningsPertinents(contexte);
    expect(resultat.relevance).toBe("CONTEXTUAL");
    expect(resultat.reason).toBe("Atlas-wide validated Learning.");
  });

  test("aucun score opaque : DIRECT précède CONTEXTUAL quelle que soit la confidence", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    // DIRECT (MISSION) en LOW confidence, CONTEXTUAL (ATLAS) en HIGH confidence —
    // la confidence ne doit JAMAIS inverser l'ordre DIRECT avant CONTEXTUAL.
    const direct = await creerLearning(mission.id, { scope: "MISSION", confidence: "LOW" });
    const contextuel = await creerLearning(mission.id, { scope: "ATLAS", confidence: "HIGH" });

    const contexte = await construireDecisionContext("MISSION", mission.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    const ids = resultats.map((r) => r.learningId);
    // ATLAS étant global, d'autres entrées CONTEXTUAL peuvent polluer le
    // résultat (pollution attendue) — seul l'ORDRE RELATIF entre le
    // DIRECT en LOW confidence et le CONTEXTUAL en HIGH confidence est
    // sous test : DIRECT doit TOUJOURS précéder, quelle que soit la
    // confidence de l'un ou l'autre.
    expect(ids.indexOf(direct.id)).toBeLessThan(ids.indexOf(contextuel.id));
  });
});

test.describe("A36.1 — Conflict handling (signal, jamais un arbitrage)", () => {
  test("BEST_PRACTICE + ANTI_PATTERN pertinents -> conflit reporté, les deux conservés", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const bp = await creerLearning(mission.id, { scope: "MISSION", type: "BEST_PRACTICE" });
    const ap = await creerLearning(mission.id, { scope: "MISSION", type: "ANTI_PATTERN" });

    const resultat = await construireContexteDecisionnel("MISSION", mission.id);
    // Note : ATLAS étant global, d'autres Learnings (type LESSON, jamais
    // BEST_PRACTICE/ANTI_PATTERN dans ce fichier) peuvent polluer
    // `learnings` sans jamais créer de conflit supplémentaire ni cacher
    // celui sous test — vérifié par présence (jamais une égalité stricte
    // de tout le tableau).
    expect(resultat.learnings.map((l) => l.learningId)).toEqual(expect.arrayContaining([ap.id, bp.id]));
    expect(resultat.conflicts).toEqual([{ learningAId: bp.id, learningBId: ap.id, type: "BEST_PRACTICE_VS_ANTI_PATTERN" }]);
    expect(resultat.status).toBe("CONFLICTING_CONTEXT");
  });

  test("confidence n'arbitre jamais un conflit (HIGH vs LOW, les deux restent)", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const bp = await creerLearning(mission.id, { scope: "MISSION", type: "BEST_PRACTICE", confidence: "HIGH" });
    const ap = await creerLearning(mission.id, { scope: "MISSION", type: "ANTI_PATTERN", confidence: "LOW" });

    const resultat = await construireContexteDecisionnel("MISSION", mission.id);
    expect(resultat.learnings.map((l) => l.learningId)).toEqual(expect.arrayContaining([bp.id, ap.id]));
    expect(resultat.conflicts).toEqual(expect.arrayContaining([{ learningAId: bp.id, learningBId: ap.id, type: "BEST_PRACTICE_VS_ANTI_PATTERN" }]));
  });

  test("la récence n'arbitre jamais un conflit (le plus récent n'évince pas l'autre)", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const ap = await creerLearning(mission.id, { scope: "MISSION", type: "ANTI_PATTERN" });
    await new Promise((r) => setTimeout(r, 5));
    const bp = await creerLearning(mission.id, { scope: "MISSION", type: "BEST_PRACTICE" }); // plus récent

    const resultat = await construireContexteDecisionnel("MISSION", mission.id);
    expect(resultat.learnings.map((l) => l.learningId)).toEqual(expect.arrayContaining([ap.id, bp.id])); // aucun des deux évincé par la récence
    expect(resultat.conflicts).toEqual(expect.arrayContaining([{ learningAId: bp.id, learningBId: ap.id, type: "BEST_PRACTICE_VS_ANTI_PATTERN" }]));
  });

  test("aucun conflit entre deux BEST_PRACTICE (même type)", () => {
    const conflits = detecterConflitsDecision([
      { learningId: "a", relevance: "DIRECT", scope: "MISSION", type: "BEST_PRACTICE", provenance: "OBSERVED", confidence: "LOW", title: "x", statement: "y", missionId: "m", applicability: "ACTIVE", source: null, reason: "r" },
      { learningId: "b", relevance: "DIRECT", scope: "MISSION", type: "BEST_PRACTICE", provenance: "OBSERVED", confidence: "LOW", title: "x", statement: "y", missionId: "m", applicability: "ACTIVE", source: null, reason: "r" },
    ]);
    expect(conflits).toEqual([]);
  });
});

test.describe("A36.1 — Security / RBAC / IDOR", () => {
  test("exclusion cross-Client : un Learning CLIENT d'un autre Client n'apparaît jamais, même connaissant son id", async () => {
    const clientA = await clientIsole();
    const clientB = await clientIsole();
    const missionA = await creerMission(clientA.id);
    const missionB = await creerMission(clientB.id);
    const learningB = await creerLearning(missionB.id, { scope: "CLIENT" });

    const contexte = await construireDecisionContext("MISSION", missionA.id);
    const resultats = await rechercherLearningsPertinents(contexte);
    expect(resultats.map((r) => r.learningId)).not.toContain(learningB.id);
  });

  test("clientId du DecisionContext provient STRICTEMENT de l'entité réelle, jamais d'une valeur injectée (aucun paramètre clientId n'existe dans la signature)", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const contexte = await construireDecisionContext("MISSION", mission.id);
    expect(contexte.clientId).toBe(client.id);
    // construireDecisionContext(decisionType, decisionEntityId) — deux
    // paramètres seulement, structurellement impossible de faire passer
    // un clientId arbitraire par l'appelant.
    expect(construireDecisionContext.length).toBe(2);
  });

  test("INGENIEUR non autorisé sur la Mission : le mécanisme RBAC existant (A26) reste le seul filtre, A36.1 ne le contourne ni ne le duplique", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const profilNonAutorise = await creerProfilIsole();

    // A36.1 ne vérifie JAMAIS lui-même ce rôle (contrat A36.1 §21/§22) —
    // l'appelant DOIT invoquer ce mécanisme existant AVANT de construire
    // un DecisionContext pour une décision MISSION. Preuve que ce
    // mécanisme reste intact et continue de refuser l'accès attendu.
    const autorise = await estIngenieurAutoriseSurMission(mission.id, profilNonAutorise.id);
    expect(autorise).toBe(false);
  });

  test("aucune fonction de lookup direct par learningId n'existe dans le module (pas de contournement par devinette d'id)", async () => {
    const module = await import("@/lib/decision-context");
    const nomsExportes = Object.keys(module);
    expect(nomsExportes.some((n) => /learning/i.test(n) && /par[iI]d|byId/i.test(n))).toBe(false);
  });
});

test.describe("A36.1 — Immutability (strictement read-only)", () => {
  test("rechercherLearningsPertinents ne modifie jamais un Learning ni ne crée de nouvelle ligne", async () => {
    const client = await clientIsole();
    const mission = await creerMission(client.id);
    const learning = await creerLearning(mission.id, { scope: "MISSION" });
    const avant = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
    const compteAvant = await prisma.learning.count();

    const contexte = await construireDecisionContext("MISSION", mission.id);
    await rechercherLearningsPertinents(contexte);
    await construireContexteDecisionnel("MISSION", mission.id);

    const apres = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
    const compteApres = await prisma.learning.count();
    expect(apres).toEqual(avant);
    expect(compteApres).toBe(compteAvant);
  });
});
