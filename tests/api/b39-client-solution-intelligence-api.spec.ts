import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { genererOuRecupererSolutions } from "@/lib/client-solution/generation";

// COMPANY ATLAS — V2.1-C/E (16/09/2026) : API C3 Solution Intelligence.
// Couvre GET /api/client/besoins/[id]/solutions, POST .../solutions/[optionId]/decision,
// GET /api/talent/besoins/[id]/solutions (Admin) — auth/RBAC/IDOR/BOLA,
// génération/idempotence/concurrence, UNKNOWN, absence de fuite Talent,
// décision/historique/changement d'avis.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
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

    test("GET solutions — INGENIEUR -> 403", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      await connecter(request, "ingenieur-demo@example.com");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(403);
    });

    test("GET solutions — ADMIN -> 403 (route Client réservée au rôle CLIENT)", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      await connecter(request, "admin-demo@example.com");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(403);
    });

    test("GET admin solutions — CLIENT / INGENIEUR -> 403", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await creerBesoinValide(client!.id);
      await connecter(request, "client-demo@example.com");
      expect((await request.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
      await connecter(request, "ingenieur-demo@example.com");
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
    test("GET solutions d'un besoin appartenant à un autre client -> 404, jamais une fuite", async ({ request }) => {
      const autreClient = await prisma.client.findFirst({
        where: { compte: { email: { not: "client-demo@example.com" } } },
      });
      const need = await creerBesoinValide(autreClient!.id);
      await connecter(request, "client-demo@example.com");
      const reponse = await request.get(`/api/client/besoins/${need.id}/solutions`);
      expect(reponse.status()).toBe(404);
    });

    test("POST decision sur une option d'un autre client -> 404, aucune décision créée", async ({ request }) => {
      const clientA = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const clientB = await prisma.client.findFirst({
        where: { compte: { email: { not: "client-demo@example.com" } }, id: { not: clientA!.id } },
      });
      const suffixe = `${Date.now()}-idor`;
      await creerProfilCandidatDeTest(suffixe);
      const needB = await creerBesoinValide(clientB!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      // Génère une recommandation pour le besoin du client B (hors session, directement en base pour préparer le test).
      const resultatB = await genererOuRecupererSolutions(needB.id, clientB!.id);
      expect(resultatB.eligible).toBe(true);
      const recommandationB = resultatB.eligible ? resultatB.recommandation : null;
      expect(recommandationB, "une recommandation doit exister pour ce test").toBeTruthy();

      await connecter(request, "client-demo@example.com");
      const reponse = await request.post(`/api/client/besoins/${needB.id}/solutions/${recommandationB!.id}/decision`);
      expect(reponse.status()).toBe(404);
      expect(await prisma.solutionOption.count({ where: { needId: needB.id, niveau: "DECISION" } })).toBe(0);
    });
  });

  test.describe("Besoin invalide / non VALIDE", () => {
    test("besoin inexistant -> 404", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.get(`/api/client/besoins/inexistant-xyz/solutions`);
      expect(reponse.status()).toBe(404);
    });

    test("besoin non VALIDE (SOUMIS) -> eligible=false, aucune génération, aucune invention", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const need = await prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `b39-${Date.now()}`, texteOriginal: "Besoin non validé", statut: "SOUMIS" },
      });
      await connecter(request, "client-demo@example.com");
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
      await connecter(request, "client-demo@example.com");
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

      await connecter(request, "client-demo@example.com");
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
    test("deux appels successifs sans changement du besoin -> mêmes lignes, aucun doublon", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-idem`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
      const r1 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const r2 = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

      expect(r1.recommandation?.id).toBe(r2.recommandation?.id);
      expect(r1.options.map((o: { id: string }) => o.id).sort()).toEqual(r2.options.map((o: { id: string }) => o.id).sort());
      expect(await prisma.solutionOption.count({ where: { needId: need.id, niveau: "OPTION" } })).toBe(r1.options.length);
    });

    test("changement du besoin (nouveau fait) -> nouvelle génération append-only, anciennes lignes conservées", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-refresh`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
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

    test("deux requêtes simultanées sur un besoin jamais généré -> aucun doublon", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-concurrence`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
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
    test("décider sur une RECOMMANDATION -> succès, décision append-only tracée", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-decision`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
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

    test("décider directement sur une OPTION (pas une RECOMMANDATION) -> 400, jamais accepté", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-optiondirecte`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
      const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const optionId = generation.options[0].id;

      const reponse = await request.post(`/api/client/besoins/${need.id}/solutions/${optionId}/decision`);
      expect(reponse.status()).toBe(400);
      expect(await prisma.solutionOption.count({ where: { needId: need.id, niveau: "DECISION" } })).toBe(0);
    });

    test("décider sur une recommandation obsolète (besoin changé depuis) -> 409", async ({ request }) => {
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      await creerProfilCandidatDeTest(`${Date.now()}-obsolete`);
      const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

      await connecter(request, "client-demo@example.com");
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

      await connecter(request, "client-demo@example.com");
      const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
      const recommandationId = generation.recommandation.id;

      const decision1 = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();
      const decision2 = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();

      expect(decision1.decision.id).not.toBe(decision2.decision.id);

      await connecter(request, "admin-demo@example.com");
      const vueAdmin = await (await request.get(`/api/talent/besoins/${need.id}/solutions`)).json();
      expect(vueAdmin.decisions.length).toBe(2);
      expect(vueAdmin.decisions.map((d: { id: string }) => d.id).sort()).toEqual([decision1.decision.id, decision2.decision.id].sort());

      // Les deux décisions restent en base, aucune n'est supprimée.
      expect(await prisma.solutionOption.findUnique({ where: { id: decision1.decision.id } })).not.toBeNull();
      expect(await prisma.solutionOption.findUnique({ where: { id: decision2.decision.id } })).not.toBeNull();
    });
  });
});
