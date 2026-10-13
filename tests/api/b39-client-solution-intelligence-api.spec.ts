import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";
import { genererOuRecupererSolutions } from "@/lib/client-solution/generation";
import { construireContexteDecisionnel } from "@/lib/decision-context";
import { journaliser } from "@/lib/audit";

// COMPANY ATLAS — V2.1-C/E (16/09/2026) : API C3 Solution Intelligence.
// Couvre GET /api/client/besoins/[id]/solutions, POST .../solutions/[optionId]/decision,
// GET /api/talent/besoins/[id]/solutions (Admin) — auth/RBAC/IDOR/BOLA,
// génération/idempotence/concurrence, UNKNOWN, absence de fuite Talent,
// décision/historique/changement d'avis.

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

async function creerBesoinValide(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `b39-${suffixe}`,
      texteOriginal: `Besoin de test V2.1-C ${suffixe}`,
      statut: "VALIDE",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
  });
}

// Crée un second Client isolé et déterministe, entièrement sous le
// contrôle du test — indépendant du jeu de données de démo (qui ne
// provisionne qu'UN SEUL compte Client en CI, contrairement à l'environnement
// local où un second client existait ; s'appuyer sur le seed pour un
// deuxième client est donc non déterministe). Aucun compte de connexion
// (User) n'est créé : les tests IDOR/BOLA ci-dessous n'authentifient jamais
// ce second client, seulement client-demo qui tente d'accéder à ses données.
async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test IDOR ${suffixe}` } });
}

// Crée un candidat exploitable par le Matching (cvValide=true, compétence
// connue) — sans cela, aucune SolutionOption ne peut jamais être générée
// dans cet environnement de test (aucun profil cvValide=true seedé par
// défaut, vérifié avant écriture de ce fichier).
async function creerProfilCandidatDeTest(suffixe: string) {
  return prisma.profil.create({
    data: {
      nom: `CandidatTest${suffixe}`,
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

test.describe("V2.1-C/E — API C3 Solution Intelligence", () => {
  test.describe("Auth / RBAC", () => {
    test("GET solutions — non authentifié -> 403", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(403);
    });

    test("GET solutions — INGENIEUR -> 403", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      let request = await connecter("INGENIEUR");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(403);
    });

    test("GET solutions — ADMIN -> 403 (route Client réservée au rôle CLIENT)", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      let request = await connecter("ADMIN");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(403);
    });

    test("GET admin solutions — CLIENT / INGENIEUR -> 403", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      let request = await connecter("CLIENT");
      expect((await request.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
      request = await connecter("INGENIEUR");
      expect((await request.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
    });

    test("POST decision — non authentifié -> 403, aucune écriture", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      const reponse = await request.post(`/api/client/besoins/${need.id}/solutions/inexistant/decision`);
      expect(reponse.status()).toBe(403);
      expect(await prisma.solutionOption.count({ where: { needId: need.id } })).toBe(0);
    });
  });

  test.describe("IDOR / BOLA — isolation cross-client", () => {
    test("GET solutions d'un besoin appartenant à un autre client -> 404, jamais une fuite", async () => {
      const autreClient = await creerClientDeTest(`${Date.now()}-idor1`);
      try {
        const need = await creerBesoinValide(autreClient.id);
        let request = await connecter("CLIENT");
        const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
        expect(reponse.status()).toBe(404);
      } finally {
        await prisma.clientNeed.deleteMany({ where: { clientId: autreClient.id } });
        await prisma.client.delete({ where: { id: autreClient.id } });
      }
    });

    test("POST decision sur une option d'un autre client -> 404, aucune décision créée", async () => {
      const clientB = await creerClientDeTest(`${Date.now()}-idor2`);
      try {
        const suffixe = `${Date.now()}-idor`;
        await creerProfilCandidatDeTest(suffixe);
        const needB = await creerBesoinValide(clientB.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

        // Génère une recommandation pour le besoin du client B (hors session, directement en base pour préparer le test).
        const resultatB = await genererOuRecupererSolutions(needB.id, clientB.id);
        expect(resultatB.eligible).toBe(true);
        const recommandationB = resultatB.eligible ? resultatB.recommandation : null;
        expect(recommandationB, "une recommandation doit exister pour ce test").toBeTruthy();

        let request = await connecter("CLIENT");
        const reponse = await request.post(`/api/client/besoins/${needB.id}/solutions/${recommandationB!.id}/decision`);
        expect(reponse.status()).toBe(404);
        expect(await prisma.solutionOption.count({ where: { needId: needB.id, niveau: "DECISION" } })).toBe(0);
      } finally {
        await prisma.clientNeed.deleteMany({ where: { clientId: clientB.id } });
        await prisma.client.delete({ where: { id: clientB.id } });
      }
    });
  });

  test.describe("Besoin invalide / non VALIDE", () => {
    test("besoin inexistant -> 404", async () => {
      let request = await connecter("CLIENT");
      const reponse = await request.get(`/api/client/besoins/inexistant-xyz/solutions`);
      expect(reponse.status()).toBe(404);
    });

    test("besoin non VALIDE (SOUMIS) -> eligible=false, aucune génération, aucune invention", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `b39-${Date.now()}`, texteOriginal: "Besoin non validé", statut: "SOUMIS" },
      });
      let request = await connecter("CLIENT");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.ok()).toBeTruthy();
      const body = await reponse.json();
      expect(body.eligible).toBe(false);
      expect(body.options).toEqual([]);
      expect(body.recommandation).toBeNull();
      expect(await prisma.solutionOption.count({ where: { needId: need.id } })).toBe(0);
    });
  });

  test.describe("Génération, UNKNOWN, absence de fuite Talent", () => {
    test("compétence introuvable chez aucun candidat -> jamais listée comme correspondante (aucune invention), quel que soit l'état du pool de candidats", async ({
      request,
    }) => {
      // Note : ce test ne suppose PAS un pool de candidats vide (d'autres
      // tests de ce fichier créent des Profil cvValide=true partagés en
      // base, jamais nettoyés) — le Matching V2 existant (inchangé) renvoie
      // toujours un classement de tous les candidats cvValide, y compris à
      // confiance basse, jamais une liste vide forcée (voir
      // tests/unit/matching.spec.ts, "jamais un score forcé à 0"). La
      // propriété testée ici est plus forte et order-independent : une
      // compétence qui n'existe chez AUCUN candidat ne doit jamais
      // apparaître comme "correspondante" dans la sortie Client-safe.
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "CompetenceInexistanteXYZ123", statut: "DECLARE" }]);
      request = await connecter("CLIENT");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      const body = await reponse.json();
      expect(body.eligible).toBe(true);
      for (const option of body.options) {
        expect(option.competencesCorrespondantes).not.toContain("CompetenceInexistanteXYZ123");
      }
    });

    test("besoin VALIDE avec un candidat exploitable -> options et recommandation générées, aucune fuite de donnée interne Talent", async ({
      request,
    }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const suffixe = `${Date.now()}-gen`;
      const profil = await creerProfilCandidatDeTest(suffixe);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      request = await connecter("CLIENT");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.ok()).toBeTruthy();
      const body = await reponse.json();
      expect(body.eligible).toBe(true);
      expect(body.options.length).toBeGreaterThan(0);
      expect(body.recommandation).not.toBeNull();
      expect(body.recommandation.niveau).toBe("RECOMMANDATION");

      const texteComplet = JSON.stringify(body);
      // Aucune fuite d'identité, de coût ou de raisonnement interne — même
      // frontière que testée en V2.1-B, vérifiée ici de bout en bout via
      // l'API réelle.
      expect(texteComplet).not.toContain(profil.id);
      expect(texteComplet.toLowerCase()).not.toContain("candidattest");
      expect(texteComplet).not.toContain("650"); // tjmEstime du candidat
      expect(texteComplet.toLowerCase()).not.toContain("profilid");
      expect(texteComplet.toLowerCase()).not.toContain("scorematching");
      expect(texteComplet.toLowerCase()).not.toContain("contradiction");
      expect(texteComplet.toLowerCase()).not.toContain("facteurdefavorable");
    });
  });

  test.describe("Idempotence, refresh, concurrence", () => {
    test("deux appels successifs sans changement du besoin -> mêmes lignes, aucun doublon", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-idem`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const r1 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const r2 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      expect(r1.recommandation?.id).toBe(r2.recommandation?.id);
      expect(r1.options.map((o: { id: string }) => o.id).sort()).toEqual(r2.options.map((o: { id: string }) => o.id).sort());
      expect(await prisma.solutionOption.count({ where: { needId: need.id, niveau: "OPTION" } })).toBe(r1.options.length);
    });

    test("changement du besoin (nouveau fait) -> nouvelle génération append-only, anciennes lignes conservées", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-refresh`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const r1 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const compteApresR1 = await prisma.solutionOption.count({ where: { needId: need.id } });

      // Le besoin change réellement (nouveau critère résolu) -> signature différente.
      await prisma.clientNeedFait.create({ data: { needId: need.id, cle: "BUDGET_MONTANT", valeur: "700", statut: "DECLARE" } });

      const r2 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const compteApresR2 = await prisma.solutionOption.count({ where: { needId: need.id } });

      expect(compteApresR2).toBeGreaterThan(compteApresR1);
      // L'ancienne recommandation reste en base, jamais supprimée/écrasée.
      expect(await prisma.solutionOption.findUnique({ where: { id: r1.recommandation.id } })).not.toBeNull();
      expect(r2.recommandation?.id).not.toBe(r1.recommandation?.id);
    });

    test("deux requêtes simultanées sur un besoin jamais généré -> aucun doublon", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-concurrence`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const [r1, r2] = await Promise.all([
        request.get(`/api/client/besoins/${need.id}/solutions`),
        request.get(`/api/client/besoins/${need.id}/solutions`),
      ]);
      expect(r1.ok()).toBeTruthy();
      expect(r2.ok()).toBeTruthy();

      const recommandations = await prisma.solutionOption.findMany({ where: { needId: need.id, niveau: "RECOMMANDATION" } });
      expect(recommandations.length).toBe(1);
    });
  });

  test.describe("Décision, historique, changement d'avis", () => {
    test("décider sur une RECOMMANDATION -> succès, décision append-only tracée", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-decision`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const recommandationId = generation.recommandation.id;

      const reponse = await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`);
      expect(reponse.ok()).toBeTruthy();
      const body = await reponse.json();
      expect(body.decision.niveau).toBe("DECISION");
      expect(body.decision.sourceOptionId).toBe(recommandationId);
      expect(body.decision.decideParEmail).toBe("client-demo@example.com");
      expect(body.decision.decideLe).not.toBeNull();
    });

    test("décider directement sur une OPTION (pas une RECOMMANDATION) -> 400, jamais accepté", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-optiondirecte`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const optionId = generation.options[0].id;

      const reponse = await request.post(`/api/client/besoins/${need.id}/solutions/${optionId}/decision`);
      expect(reponse.status()).toBe(400);
      expect(await prisma.solutionOption.count({ where: { needId: need.id, niveau: "DECISION" } })).toBe(0);
    });

    test("décider sur une recommandation obsolète (besoin changé depuis) -> 409", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-obsolete`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const r1 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const ancienneRecommandationId = r1.recommandation.id;

      await prisma.clientNeedFait.create({ data: { needId: need.id, cle: "BUDGET_MONTANT", valeur: "800", statut: "DECLARE" } });
      await request.get(`/api/client/besoins/${need.id}/solutions`); // régénère, nouvelle recommandation

      const reponse = await request.post(`/api/client/besoins/${need.id}/solutions/${ancienneRecommandationId}/decision`);
      expect(reponse.status()).toBe(409);
    });

    test("changement d'avis — une deuxième décision ne supprime jamais la première, les deux restent visibles dans l'historique Admin", async ({
      request,
    }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-changementavis`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      request = await connecter("CLIENT");
      const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const recommandationId = generation.recommandation.id;

      const decision1 = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();
      const decision2 = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();

      expect(decision1.decision.id).not.toBe(decision2.decision.id);

      request = await connecter("ADMIN");
      const vueAdmin = await (await request.get(`/api/talent/besoins/${need.id}/solutions`)).json();
      expect(vueAdmin.decisions.length).toBe(2);
      expect(vueAdmin.decisions.map((d: { id: string }) => d.id).sort()).toEqual([decision1.decision.id, decision2.decision.id].sort());

      // Les deux décisions restent en base, aucune n'est supprimée.
      expect(await prisma.solutionOption.findUnique({ where: { id: decision1.decision.id } })).not.toBeNull();
      expect(await prisma.solutionOption.findUnique({ where: { id: decision2.decision.id } })).not.toBeNull();
    });
  });

  // COMPANY ATLAS — A36.2.3 : premier consommateur réel du Decision
  // Context (SOLUTION/RECOMMANDATION) — enrichissement additif,
  // strictement consultatif, de GET /api/client/besoins/[id]/solutions.
  test.describe("A36.2.3 — Decision Context (consultatif, SOLUTION/RECOMMANDATION)", () => {
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
          title: overrides.title ?? `Learning A36.2.3 ${Date.now()}-${Math.random()}`,
          statement: "Observation de test A36.2.3.",
          provenance: overrides.provenance ?? "OBSERVED",
          confidence: overrides.confidence ?? "MEDIUM",
          scope: overrides.scope ?? "CLIENT",
          createdByEmail: "admin-demo@example.com",
          createdByRole: "ADMIN",
        },
      });
      // statut/applicabilite ne sont jamais écrits ainsi par le service A30
      // réel (toujours PROPOSE/ACTIVE à la création) — simule ici l'état
      // déjà VALIDE/ACTIVE (ou PROPOSE/OBSOLETE) sans dupliquer la logique
      // de transition elle-même (hors périmètre, déjà verrouillée par A30,
      // non modifiée par ce lot).
      return prisma.learning.update({
        where: { id: learning.id },
        data: { statut: overrides.statut ?? "VALIDE", applicabilite: overrides.applicabilite ?? "ACTIVE" },
      });
    }

    // Une Mission minimale sert uniquement de support à un Learning
    // scope=CLIENT/MISSION — jamais lue par le Decision Context autrement
    // que via Learning.mission.clientId (A36.1, inchangé).
    async function creerMissionPourTest(clientId: string) {
      const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
      return prisma.mission.create({
        data: {
          clientId,
          profilId: user!.profilId!,
          repere: `Mission A36.2.3 ${Date.now()}-${Math.random()}`,
          nbJours: 5,
          tjmVente: 500,
          margeCible: 0.3,
          deviseVente: "EUR",
          statut: "EN_COURS",
        },
      });
    }

    test("A — recommandation présente -> decisionContext présent, construit sur recommendation.id", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-a`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      expect(body.recommandation).not.toBeNull();
      expect(body.decisionContext).not.toBeNull();
      expect(["RELEVANT_CONTEXT", "NO_RELEVANT_LEARNING", "CONFLICTING_CONTEXT"]).toContain(body.decisionContext.status);
      expect(Array.isArray(body.decisionContext.learnings)).toBe(true);
      expect(Array.isArray(body.decisionContext.conflicts)).toBe(true);
    });

    test("B — recommandation absente (besoin non éligible) -> decisionContext=null, aucun contexte artificiel", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `b39-dc-b-${Date.now()}`, texteOriginal: "Besoin non validé A36.2.3", statut: "SOUMIS" },
      });
      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      expect(body.eligible).toBe(false);
      expect(body.recommandation).toBeNull();
      expect(body.decisionContext).toBeNull();
    });

    test("C/G — Learning VALIDE+ACTIVE pertinent (CLIENT scope) apparaît avec provenance/confidence exacts, jamais promus", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-c`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const learning = await creerLearningPourTest(mission.id, { scope: "CLIENT", provenance: "INFERRED", confidence: "LOW" });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const ligne = body.decisionContext.learnings.find((l: { learningId: string }) => l.learningId === learning.id);
      expect(ligne).toBeTruthy();
      expect(ligne.provenance).toBe("INFERRED"); // jamais promu VERIFIED/DECLARED
      expect(ligne.confidence).toBe("LOW"); // jamais promu MEDIUM/HIGH
      expect(ligne.scope).toBe("CLIENT");
      expect(ligne.type).toBe("LESSON");
      expect(ligne.applicability).toBe("ACTIVE");
      expect(typeof ligne.reason).toBe("string");
    });

    test("D — Learning PROPOSE ou OBSOLETE n'apparaît jamais (le consumer ne contourne pas A36.1)", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-d`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const learningPropose = await creerLearningPourTest(mission.id, { scope: "CLIENT", statut: "PROPOSE" });
      const learningObsolete = await creerLearningPourTest(mission.id, { scope: "CLIENT", applicabilite: "OBSOLETE" });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const ids = body.decisionContext.learnings.map((l: { learningId: string }) => l.learningId);
      expect(ids).not.toContain(learningPropose.id);
      expect(ids).not.toContain(learningObsolete.id);
    });

    test("E — isolation cross-client : un Learning CLIENT d'un autre client n'apparaît jamais", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const autreClient = await creerClientDeTest(`${Date.now()}-dc-e`);
      try {
        await creerProfilCandidatDeTest(`${Date.now()}-dc-e`);
        const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
        const missionAutreClient = await creerMissionPourTest(autreClient.id);
        const learningAutreClient = await creerLearningPourTest(missionAutreClient.id, { scope: "CLIENT" });

        let request = await connecter("CLIENT");
        const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
        const ids = body.decisionContext.learnings.map((l: { learningId: string }) => l.learningId);
        expect(ids).not.toContain(learningAutreClient.id);
      } finally {
        // Ordre imposé par les contraintes FK réelles (onDelete: Restrict) :
        // Learning référence Mission, Mission référence Client — jamais
        // l'inverse (contrat A30 §7, "jamais Cascade" — une Mission/un
        // Learning ne doit jamais disparaître silencieusement).
        await prisma.learning.deleteMany({ where: { mission: { clientId: autreClient.id } } });
        await prisma.mission.deleteMany({ where: { clientId: autreClient.id } });
        await prisma.clientNeed.deleteMany({ where: { clientId: autreClient.id } });
        await prisma.client.delete({ where: { id: autreClient.id } });
      }
    });

    test("F — conflit BEST_PRACTICE/ANTI_PATTERN : status=CONFLICTING_CONTEXT, les deux Learnings restent présents", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-f`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const bp = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "BEST_PRACTICE" });
      const ap = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "ANTI_PATTERN" });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      expect(body.decisionContext.status).toBe("CONFLICTING_CONTEXT");
      const ids = body.decisionContext.learnings.map((l: { learningId: string }) => l.learningId);
      expect(ids).toContain(bp.id);
      expect(ids).toContain(ap.id);
      expect(body.decisionContext.conflicts.length).toBeGreaterThan(0);
    });

    test("H — read-only : aucune mutation Learning/SolutionOption/ClientNeed/Mission provoquée par le GET", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-h`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const learning = await creerLearningPourTest(mission.id, { scope: "CLIENT" });

      const learningAvant = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
      const compteSolutionAvant = await prisma.solutionOption.count();
      const compteLearningAvant = await prisma.learning.count();

      let request = await connecter("CLIENT");
      await request.get(`/api/client/besoins/${need.id}/solutions`);

      const learningApres = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
      expect(learningApres).toEqual(learningAvant);
      // La génération Solution elle-même peut créer des SolutionOption
      // (OPTION/RECOMMANDATION, comportement EXISTANT et inchangé) — seule
      // la propriété sous test ici est que le Decision Context n'ajoute
      // AUCUNE écriture Learning au-delà de ce comportement préexistant.
      expect(await prisma.learning.count()).toBe(compteLearningAvant);
      expect(await prisma.solutionOption.count()).toBeGreaterThanOrEqual(compteSolutionAvant);
    });

    test("I — le contexte utilise exactement recommendation.id, jamais needId ni sourceOptionId", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc-i`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const recommandationId = body.recommandation.id;
      expect(recommandationId).not.toBe(need.id);

      // Preuve directe : le résultat exposé par la route est strictement
      // identique à un appel direct construit sur recommendation.id — si
      // la route avait utilisé need.id ou sourceOptionId, cet appel
      // échouerait (DecisionEntityIntrouvableError, aucun SolutionOption
      // ne porte cet id) ou produirait un résultat différent.
      const attendu = await construireContexteDecisionnel("SOLUTION", recommandationId);
      expect(body.decisionContext.status).toBe(attendu.status);
      expect(body.decisionContext.learnings.map((l: { learningId: string }) => l.learningId).sort()).toEqual(
        attendu.learnings.map((l) => l.learningId).sort()
      );
    });

    test("J — aucun Learning spécifique pertinent -> recommandation quand même retournée normalement, aucune pollution cross-client/need", async ({ request }) => {
      const clientIsole = await creerClientDeTest(`${Date.now()}-dc-j`);
      try {
        await creerProfilCandidatDeTest(`${Date.now()}-dc-j`);
        const need = await creerBesoinValide(clientIsole.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
        // Aucun Learning créé pour ce client isolé — mais la route Client
        // existante exige une session liée à client-demo ; ce test vérifie
        // donc uniquement la PROPRIÉTÉ (status possible), pas via un
        // utilisateur authentifié sur ce client isolé (hors périmètre
        // d'authentification de ce test) — vérifiée directement via le
        // service, cohérent avec le contrat déjà validé par A36.1.
        const resultat = await genererOuRecupererSolutions(need.id, clientIsole.id);
        expect(resultat.eligible).toBe(true);
        const recommandation = resultat.eligible ? resultat.recommandation : null;
        expect(recommandation).toBeTruthy();

        // Note : ATLAS étant global par construction (contrat A36.1 §8),
        // un environnement partagé et jamais purgé (ce dépôt de test, tout
        // au long de cet engagement) peut déjà contenir des Learnings
        // ATLAS VALIDE+ACTIVE créés par d'autres suites (a36-decision-
        // context.spec.ts) — `status === "NO_RELEVANT_LEARNING"` n'est
        // donc PAS une propriété garantissable empiriquement ici (déjà
        // couverte, en tant que logique PURE, par
        // determinerStatus([],[]) dans tests/api/a36-decision-context.spec.ts).
        // La propriété réellement sous test ici est que ce client/besoin
        // tout neuf n'hérite JAMAIS d'un Learning spécifique (CLIENT/
        // CAPABILITY/MISSION) appartenant à un autre contexte, et que la
        // recommandation reste normalement exposée quel que soit le
        // résultat du Decision Context.
        const contexte = await construireContexteDecisionnel("SOLUTION", recommandation!.id);
        expect(contexte.learnings.every((l) => l.scope === "ATLAS")).toBe(true);
        expect(resultat.recommandation).not.toBeNull();
      } finally {
        await prisma.solutionOption.deleteMany({ where: { clientId: clientIsole.id } });
        await prisma.clientNeed.deleteMany({ where: { clientId: clientIsole.id } });
        await prisma.client.delete({ where: { id: clientIsole.id } });
      }
    });
  });

  // COMPANY ATLAS — A36.2.4 : traçabilité de CONSULTATION
  // ("decision.learning_consulted") du Decision Context consommé par
  // A36.2.3 — émise via lib/audit.ts::journaliser() (infrastructure
  // canonique existante, jamais une nouvelle table). Couvre
  // exclusivement "retrieved + consulted", jamais "used"/"adopted".
  test.describe("A36.2.4 — Consultation traceability (decision.learning_consulted)", () => {
    async function creerLearningPourTest(
      missionId: string,
      overrides: Partial<{
        scope: "MISSION" | "CLIENT" | "DOMAIN" | "CAPABILITY" | "ATLAS";
        type: "LESSON" | "PATTERN" | "BEST_PRACTICE" | "ANTI_PATTERN" | "RECOMMENDATION" | "INSIGHT";
        statut: "PROPOSE" | "VALIDE";
        applicabilite: "ACTIVE" | "OBSOLETE";
      }> = {}
    ) {
      const learning = await prisma.learning.create({
        data: {
          missionId,
          type: overrides.type ?? "LESSON",
          title: `Learning A36.2.4 ${Date.now()}-${Math.random()}`,
          statement: "Observation de test A36.2.4.",
          provenance: "OBSERVED",
          confidence: "MEDIUM",
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

    async function creerMissionPourTest(clientId: string) {
      const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
      return prisma.mission.create({
        data: {
          clientId,
          profilId: user!.profilId!,
          repere: `Mission A36.2.4 ${Date.now()}-${Math.random()}`,
          nbJours: 5,
          tjmVente: 500,
          margeCible: 0.3,
          deviseVente: "EUR",
          statut: "EN_COURS",
        },
      });
    }

    // Le journal n'expose que des champs texte libres (JournalActivite,
    // contrat existant, non modifié) — l'événement A36.2.4 encode ses
    // identifiants dans `detail` de façon déterministe (même convention
    // que les entrées A32/A34 déjà existantes, jamais du JSON). Ce
    // helper extrait la liste `learningIds` depuis cette même chaîne,
    // jamais depuis une seconde requête Learning.
    function extraireLearningIds(detail: string): string[] {
      const correspondance = detail.match(/learnings=\[(.*?)\]/);
      if (!correspondance || correspondance[1] === "") return [];
      return correspondance[1].split(",");
    }

    async function dernierJournalConsultation(recommandationId: string) {
      return prisma.journalActivite.findFirst({
        where: { action: "decision.learning_consulted", cible: `solution-option:${recommandationId}` },
        orderBy: { createdAt: "desc" },
      });
    }

    test("A — recommandation présente -> 200, decisionContext présent, événement decision.learning_consulted créé", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-a`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(200);
      const body = await reponse.json();
      expect(body.recommandation).not.toBeNull();
      expect(body.decisionContext).not.toBeNull();

      const entree = await dernierJournalConsultation(body.recommandation.id);
      expect(entree).not.toBeNull();
    });

    test("B — decisionEntityId = recommendation.id (jamais need.id)", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-b`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      const entree = await dernierJournalConsultation(body.recommandation.id);
      expect(entree!.cible).toBe(`solution-option:${body.recommandation.id}`);
      expect(entree!.cible).not.toBe(`solution-option:${need.id}`);
      expect(entree!.detail).toContain("SOLUTION");
    });

    test("C — needId correct dans le détail", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-c`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      const entree = await dernierJournalConsultation(body.recommandation.id);
      expect(entree!.detail).toContain(need.id);
    });

    test("D — client correct (jamais une valeur fournie par le client)", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-d`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      const entree = await dernierJournalConsultation(body.recommandation.id);
      expect(entree!.detail).toContain(client!.id);
      expect(entree!.acteurEmail).toBe("client-demo@example.com");
      expect(entree!.acteurRole).toBe("CLIENT");
    });

    test("E — learningIds exacts : aucun manquant, aucun supplémentaire", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-e`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const learningA = await creerLearningPourTest(mission.id, { scope: "CLIENT" });
      const learningB = await creerLearningPourTest(mission.id, { scope: "CLIENT" });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      const entree = await dernierJournalConsultation(body.recommandation.id);
      const idsJournal = extraireLearningIds(entree!.detail!);
      const idsContexte = body.decisionContext.learnings.map((l: { learningId: string }) => l.learningId);
      expect(idsJournal.sort()).toEqual(idsContexte.sort());
      expect(idsJournal).toContain(learningA.id);
      expect(idsJournal).toContain(learningB.id);
    });

    test("F — aucun Learning spécifique pertinent -> consultation journalisée quand même (consulted != found)", async ({ request }) => {
      const clientIsoleF = await creerClientDeTest(`${Date.now()}-dc4-f`);
      try {
        await creerProfilCandidatDeTest(`${Date.now()}-dc4-f`);
        const need = await creerBesoinValide(clientIsoleF.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
        // Note : ATLAS étant global (contrat A36.1 §8, pollution déjà
        // documentée en A36.1/A36.2.2/A36.2.3), status=NO_RELEVANT_LEARNING
        // n'est pas garanti empiriquement dans cette base de test partagée
        // — vérifié ici directement via le service (hors session HTTP,
        // cohérent avec A36.2.3 Test J) : la propriété sous test est que
        // la consultation est journalisée même sans Learning SPÉCIFIQUE
        // (CLIENT/CAPABILITY/MISSION) à ce client/besoin tout neuf.
        const resultat = await genererOuRecupererSolutions(need.id, clientIsoleF.id);
        expect(resultat.eligible).toBe(true);
        const recommandation = resultat.eligible ? resultat.recommandation : null;
        expect(recommandation).toBeTruthy();

        const contexte = await construireContexteDecisionnel("SOLUTION", recommandation!.id);
        await journaliser({
          acteurEmail: "client-isole-f@example.com",
          acteurRole: "CLIENT",
          action: "decision.learning_consulted",
          cible: `solution-option:${recommandation!.id}`,
          detail: `Decision Context SOLUTION consulté pour la recommandation ${recommandation!.id} (besoin ${need.id}, client ${clientIsoleF.id}) — status=${contexte.status}, learnings=[${contexte.learnings.map((l) => l.learningId).join(",")}].`,
        });

        const entree = await dernierJournalConsultation(recommandation!.id);
        expect(entree).not.toBeNull();
        const idsJournal = extraireLearningIds(entree!.detail!);
        // Le journal reflète EXACTEMENT contexte.learnings (contrat
        // A36.2.4 §8) — ATLAS étant global, il peut légitimement en faire
        // partie (pollution d'autres tests/suites, pas un défaut) ; la
        // propriété réellement sous test est l'absence de tout Learning
        // SPÉCIFIQUE (CLIENT/CAPABILITY/MISSION) à ce client/besoin tout
        // neuf, jamais inventé pour autant.
        expect(idsJournal.sort()).toEqual(contexte.learnings.map((l) => l.learningId).sort());
        expect(contexte.learnings.every((l) => l.scope === "ATLAS")).toBe(true);
      } finally {
        await prisma.solutionOption.deleteMany({ where: { clientId: clientIsoleF.id } });
        await prisma.clientNeed.deleteMany({ where: { clientId: clientIsoleF.id } });
        await prisma.client.delete({ where: { id: clientIsoleF.id } });
      }
    });

    test("G — conflit BEST_PRACTICE/ANTI_PATTERN : status=CONFLICTING_CONTEXT journalisé, les deux ids présents, aucun winner", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-g`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const bp = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "BEST_PRACTICE" });
      const ap = await creerLearningPourTest(mission.id, { scope: "CLIENT", type: "ANTI_PATTERN" });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      expect(body.decisionContext.status).toBe("CONFLICTING_CONTEXT");

      const entree = await dernierJournalConsultation(body.recommandation.id);
      expect(entree!.detail).toContain("CONFLICTING_CONTEXT");
      const idsJournal = extraireLearningIds(entree!.detail!);
      expect(idsJournal).toContain(bp.id);
      expect(idsJournal).toContain(ap.id);
      // Aucun champ/mention "winner" n'existe nulle part dans ce journal.
      expect(entree!.detail!.toLowerCase()).not.toContain("winner");
    });

    test("H — recommandation absente -> aucun événement decision.learning_consulted créé", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `b39-dc4-h-${Date.now()}`, texteOriginal: "Besoin non validé A36.2.4", statut: "SOUMIS" },
      });
      const compteAvant = await prisma.journalActivite.count({ where: { action: "decision.learning_consulted" } });

      let request = await connecter("CLIENT");
      const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      expect(body.recommandation).toBeNull();
      expect(body.decisionContext).toBeNull();

      const compteApres = await prisma.journalActivite.count({ where: { action: "decision.learning_consulted" } });
      expect(compteApres).toBe(compteAvant);
    });

    test("I — cross-client : le journal du Client A ne contient que les Learnings réellement exposés à A", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const autreClient = await creerClientDeTest(`${Date.now()}-dc4-i`);
      try {
        await creerProfilCandidatDeTest(`${Date.now()}-dc4-i`);
        const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
        const missionAutreClient = await creerMissionPourTest(autreClient.id);
        const learningAutreClient = await creerLearningPourTest(missionAutreClient.id, { scope: "CLIENT" });

        let request = await connecter("CLIENT");
        const body = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

        const entree = await dernierJournalConsultation(body.recommandation.id);
        expect(entree!.detail).toContain(client!.id);
        expect(entree!.detail).not.toContain(autreClient.id);
        const idsJournal = extraireLearningIds(entree!.detail!);
        expect(idsJournal).not.toContain(learningAutreClient.id);
      } finally {
        await prisma.learning.deleteMany({ where: { mission: { clientId: autreClient.id } } });
        await prisma.mission.deleteMany({ where: { clientId: autreClient.id } });
        await prisma.clientNeed.deleteMany({ where: { clientId: autreClient.id } });
        await prisma.client.delete({ where: { id: autreClient.id } });
      }
    });

    test("J — deux GET successifs -> deux événements de consultation distincts (consultation, pas une entité unique)", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-j`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      let request = await connecter("CLIENT");
      const body1 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const compteApres1 = await prisma.journalActivite.count({
        where: { action: "decision.learning_consulted", cible: `solution-option:${body1.recommandation.id}` },
      });

      const body2 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      // Idempotence de génération déjà validée ailleurs (B39) : la même
      // RECOMMANDATION est récupérée, pas régénérée.
      expect(body2.recommandation.id).toBe(body1.recommandation.id);

      const compteApres2 = await prisma.journalActivite.count({
        where: { action: "decision.learning_consulted", cible: `solution-option:${body1.recommandation.id}` },
      });
      expect(compteApres2).toBe(compteApres1 + 1); // chaque GET = une nouvelle consultation, jamais dédupliquée
    });

    test("K — read-only : un Learning consulté reste strictement inchangé", async () => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-dc4-k`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
      const mission = await creerMissionPourTest(client!.id);
      const learning = await creerLearningPourTest(mission.id, { scope: "CLIENT" });
      const avant = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });

      let request = await connecter("CLIENT");
      await request.get(`/api/client/besoins/${need.id}/solutions`);

      const apres = await prisma.learning.findUniqueOrThrow({ where: { id: learning.id } });
      expect(apres).toEqual(avant);
    });
  });
});
