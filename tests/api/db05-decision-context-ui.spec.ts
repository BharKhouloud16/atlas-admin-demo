import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";
import { construireContexteDecisionnel } from "@/lib/decision-context";

// COMPANY ATLAS — DB-05 : Decision Context UI (08/10/2026).
//
// Couvre les 19 scénarios obligatoires du mandat DB-05 §19. DB-05 ne
// modifie AUCUN fichier de lib/decision-context/* (A36.1, inchangé) — ce
// fichier verrouille le contrat tel qu'il est réellement consommé par la
// nouvelle route Admin (app/api/talent/besoins/[id]/solutions/route.ts,
// seul fichier backend touché par ce lot) et la nouvelle UI (app/admin/
// talent/besoins/[id]/page.tsx), jamais une réimplémentation de
// a36-decision-context.spec.ts ou de la section A36.2.3/A36.2.4 de
// tests/api/b39-client-solution-intelligence-api.spec.ts (déjà
// exhaustives sur le moteur et la route Client, non modifiées).

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Réutilise la session déjà authentifiée une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test — élimine la contribution de ce fichier à
// l'épuisement du rate-limit de connexion partagé par IP en CI
// (lib/rate-limit.ts), sans changer le rôle/contexte testé.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function creerBesoinValide(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `db05-${suffixe}`,
      texteOriginal: `Besoin de test DB-05 ${suffixe}`,
      statut: "VALIDE",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
  });
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test DB05 ${suffixe}` } });
}

// Candidat exploitable par le Matching (cvValide=true, compétence connue)
// — nécessaire pour qu'une SolutionOption RECOMMANDATION soit générée.
async function creerProfilCandidatDeTest(suffixe: string) {
  return prisma.profil.create({
    data: {
      nom: `CandidatTestDB05${suffixe}`,
      prenom: "Test",
      cvValide: true,
      competences: ["Kubernetes"],
      seniorite: "Senior",
      anneesExperience: 6,
      tjmEstime: 650,
      disponibilite: "Disponible immédiatement",
    },
  });
}

async function creerMissionPourTest(clientId: string) {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  return prisma.mission.create({
    data: {
      clientId,
      profilId: user!.profilId!,
      repere: `Mission DB05 ${Date.now()}-${Math.random()}`,
      nbJours: 5,
      tjmVente: 500,
      margeCible: 0.3,
      deviseVente: "EUR",
      statut: "EN_COURS",
    },
  });
}

async function creerLearningPourTest(
  missionId: string,
  overrides: Partial<{
    scope: "MISSION" | "CLIENT" | "DOMAIN" | "CAPABILITY" | "ATLAS";
    type: "LESSON" | "PATTERN" | "BEST_PRACTICE" | "ANTI_PATTERN" | "RECOMMENDATION" | "INSIGHT";
    statut: "PROPOSE" | "VALIDE";
    applicabilite: "ACTIVE" | "OBSOLETE";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    provenance: "OBSERVED" | "DECLARED" | "VERIFIED" | "INFERRED";
    title: string;
  }> = {}
) {
  const learning = await prisma.learning.create({
    data: {
      missionId,
      type: overrides.type ?? "LESSON",
      title: overrides.title ?? `Learning DB05 ${Date.now()}-${Math.random()}`,
      statement: "Observation de test DB-05.",
      provenance: overrides.provenance ?? "OBSERVED",
      confidence: overrides.confidence ?? "MEDIUM",
      scope: overrides.scope ?? "CLIENT",
      createdByEmail: "admin-demo@example.com",
      createdByRole: "ADMIN",
    },
  });
  return prisma.learning.update({
    where: { id: learning.id },
    data: { statut: overrides.statut ?? "VALIDE", applicabilite: overrides.applicabilite ?? "ACTIVE" },
  });
}

async function obtenirRecommandationAdmin(request: APIRequestContext, needId: string) {
  const client = await connecter("CLIENT");
  await client.get(`/api/client/besoins/${needId}/solutions`); // déclenche la génération réelle
  const admin = await connecter("ADMIN");
  return (await (await admin.get(`/api/talent/besoins/${needId}/solutions`)).json()) as {
    options: { id: string }[];
    recommandations: { id: string }[];
    decisions: { id: string }[];
    decisionContext: {
      subjectId: string;
      subjectNiveau: string;
      status: string;
      learnings: { learningId: string; relevance: string; scope: string; provenance: string; confidence: string; applicability: string; source: unknown; missionId: string }[];
      conflicts: { learningAId: string; learningBId: string; type: string }[];
    } | null;
  };
}

test.describe("DB-05 — Decision Context (endpoint Admin)", () => {
  test("1. endpoint Solutions Admin retourne un DecisionContext quand une recommandation existe", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-1`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    const body = await obtenirRecommandationAdmin(request, need.id);
    expect(body.recommandations.length).toBeGreaterThan(0);
    expect(body.decisionContext).not.toBeNull();
    expect(["RELEVANT_CONTEXT", "NO_RELEVANT_LEARNING", "CONFLICTING_CONTEXT"]).toContain(body.decisionContext!.status);
  });

  test("2. le contexte SOLUTION utilise exactement le decisionEntityId de la recommandation (jamais needId)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-2`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    const body = await obtenirRecommandationAdmin(request, need.id);
    const recommandationId = body.recommandations[body.recommandations.length - 1].id;
    expect(body.decisionContext!.subjectId).toBe(recommandationId);
    expect(body.decisionContext!.subjectId).not.toBe(need.id);

    // Preuve directe (même technique que b39/A36.2.3 test I) : le résultat
    // exposé est strictement identique à un appel direct sur ce même id.
    const attendu = await construireContexteDecisionnel("SOLUTION", recommandationId);
    expect(body.decisionContext!.status).toBe(attendu.status);
    expect(body.decisionContext!.learnings.map((l) => l.learningId).sort()).toEqual(attendu.learnings.map((l) => l.learningId).sort());
  });

  test("3. tant qu'aucune décision n'existe, solutionDecisionId n'est jamais inventé (contrat A36.2.2, inchangé)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-3`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    const body = await obtenirRecommandationAdmin(request, need.id);
    expect(body.decisions.length).toBe(0);
    expect(body.decisionContext!.subjectNiveau).toBe("RECOMMANDATION");
    const recommandationId = body.decisionContext!.subjectId;
    const contexte = await construireContexteDecisionnel("SOLUTION", recommandationId);
    expect(contexte.context.solutionDecisionId).toBeUndefined();
  });

  test("4. une fois une décision prise, le DecisionContext Admin porte sur la décision et conserve solutionDecisionId", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-4`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    const recommandationId = generation.recommandation.id;
    const decisionResp = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();

    request = await connecter("ADMIN");
    const body = await (await (await request.get(`/api/talent/besoins/${need.id}/solutions`)).json());
    expect(body.decisionContext.subjectNiveau).toBe("DECISION");
    expect(body.decisionContext.subjectId).toBe(decisionResp.decision.id);

    const contexte = await construireContexteDecisionnel("SOLUTION", decisionResp.decision.id);
    expect(contexte.context.solutionDecisionId).toBe(decisionResp.decision.id);
  });

  test("5/8/9/10/12. Learnings présents affichés avec provenance/confidence/scope/source exacts, jamais recalculés", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-5`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    const learning = await creerLearningPourTest(mission.id, { scope: "CLIENT", provenance: "INFERRED", confidence: "LOW" });

    const body = await obtenirRecommandationAdmin(request, need.id);
    const ligne = body.decisionContext!.learnings.find((l) => l.learningId === learning.id);
    expect(ligne).toBeTruthy();
    expect(ligne!.provenance).toBe("INFERRED"); // jamais promu
    expect(ligne!.confidence).toBe("LOW"); // jamais promu
    expect(ligne!.scope).toBe("CLIENT");
    expect(ligne!.missionId).toBe(mission.id);
    expect(ligne!.source).toBeNull(); // aucun pointeur source renseigné sur ce Learning de test
  });

  test("6. relevance DIRECT affichée (scope CLIENT, même client)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-6`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    const learning = await creerLearningPourTest(mission.id, { scope: "CLIENT" });

    const body = await obtenirRecommandationAdmin(request, need.id);
    const ligne = body.decisionContext!.learnings.find((l) => l.learningId === learning.id);
    expect(ligne!.relevance).toBe("DIRECT");
  });

  test("7. relevance CONTEXTUAL affichée (scope ATLAS)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-7`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    const learning = await creerLearningPourTest(mission.id, { scope: "ATLAS" });

    try {
      const body = await obtenirRecommandationAdmin(request, need.id);
      const ligne = body.decisionContext!.learnings.find((l) => l.learningId === learning.id);
      expect(ligne!.relevance).toBe("CONTEXTUAL");
    } finally {
      // Un Learning scope=ATLAS est visible par CONSTRUCTION dans TOUT
      // DecisionContext (A36.1, contrat inchangé) — jamais une pollution à
      // tolérer indéfiniment quand elle peut simplement être évitée : ce
      // Learning n'a aucune utilité après cette assertion, donc il est
      // supprimé ici plutôt que laissé à polluer, pour toute la durée de
      // l'exécution de la suite, les assertions d'autres fichiers (ex.
      // b39, A36.2.3/A36.2.4) qui vérifient l'ABSENCE de certaines
      // données dans un DecisionContext ATLAS forcément partagé.
      // Balayage par préfixe de titre (jamais par id seul) pour aussi
      // rattraper toute ligne orpheline laissée par une exécution
      // antérieure de ce même test, avant l'ajout de ce bloc finally.
      await prisma.learning.deleteMany({ where: { title: { startsWith: "Learning DB05 " } } });
    }
  });

  test("11. seuls les Learnings VALIDE+ACTIVE apparaissent jamais (statut affiché = invariant backend)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-11`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    const propose = await creerLearningPourTest(mission.id, { scope: "CLIENT", statut: "PROPOSE" });
    const obsolete = await creerLearningPourTest(mission.id, { scope: "CLIENT", applicabilite: "OBSOLETE" });

    const body = await obtenirRecommandationAdmin(request, need.id);
    const ids = body.decisionContext!.learnings.map((l) => l.learningId);
    expect(ids).not.toContain(propose.id);
    expect(ids).not.toContain(obsolete.id);
    expect(body.decisionContext!.learnings.every((l) => l.applicability === "ACTIVE")).toBe(true);
  });

  test("13/14. conflits affichés, sans aucun champ winner", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-13`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    const bp = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "BEST_PRACTICE" });
    const ap = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "ANTI_PATTERN" });

    const body = await obtenirRecommandationAdmin(request, need.id);
    expect(body.decisionContext!.status).toBe("CONFLICTING_CONTEXT");
    expect(body.decisionContext!.conflicts.length).toBeGreaterThan(0);
    const ids = body.decisionContext!.learnings.map((l) => l.learningId);
    expect(ids).toContain(bp.id); // les deux restent présents
    expect(ids).toContain(ap.id);
    expect(JSON.stringify(body.decisionContext).toLowerCase()).not.toContain("winner");
  });

  test("15. aucun Learning inventé : tous les ids retournés correspondent à des Learning VALIDE+ACTIVE réels", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-15`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const mission = await creerMissionPourTest(client!.id);
    await creerLearningPourTest(mission.id, { scope: "CLIENT" });

    const body = await obtenirRecommandationAdmin(request, need.id);
    const ids = body.decisionContext!.learnings.map((l) => l.learningId);
    const reels = await prisma.learning.findMany({ where: { id: { in: ids } }, select: { id: true, statut: true, applicabilite: true } });
    expect(reels.length).toBe(ids.length);
    expect(reels.every((l) => l.statut === "VALIDE" && l.applicabilite === "ACTIVE")).toBe(true);
  });
});

test.describe("DB-05 — Sécurité / RBAC / isolation", () => {
  test("16. le decisionContext de la route Client n'expose aucun champ interne additionnel (subjectId/subjectNiveau réservés à l'Admin)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-16`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(body.decisionContext).not.toBeNull();
    expect(Object.keys(body.decisionContext).sort()).toEqual(["conflicts", "learnings", "status"]);
    expect(body.decisionContext.subjectId).toBeUndefined();
    expect(body.decisionContext.subjectNiveau).toBeUndefined();
  });

  test("17. endpoint Solutions Admin reste réservé ADMIN (CLIENT/INGENIEUR -> 403, aucune donnée)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinValide(client!.id);

    let request = await connecter("CLIENT");
    expect((await request.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
    request = await connecter("INGENIEUR");
    expect((await request.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
  });

  test("18. besoin inexistant -> 404 (comportement existant, inchangé)", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get(`/api/talent/besoins/inexistant-cuid/solutions`);
    expect(reponse.status()).toBe(404);
  });

  test("19. Learning CLIENT d'un autre client n'apparaît jamais dans le DecisionContext Admin", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const autreClient = await creerClientDeTest(`${Date.now()}-19`);
    try {
      await creerProfilCandidatDeTest(`${Date.now()}-19`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const missionAutreClient = await creerMissionPourTest(autreClient.id);
      const learningAutreClient = await creerLearningPourTest(missionAutreClient.id, { scope: "CLIENT" });

      const body = await obtenirRecommandationAdmin(request, need.id);
      const ids = body.decisionContext!.learnings.map((l) => l.learningId);
      expect(ids).not.toContain(learningAutreClient.id);
    } finally {
      await prisma.learning.deleteMany({ where: { mission: { clientId: autreClient.id } } });
      await prisma.mission.deleteMany({ where: { clientId: autreClient.id } });
      await prisma.clientNeed.deleteMany({ where: { clientId: autreClient.id } });
      await prisma.client.delete({ where: { id: autreClient.id } });
    }
  });
});
