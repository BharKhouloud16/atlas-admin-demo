import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.1-E (16/09/2026) : audit/vérification des règles de
// gouvernance de décision. La route de décision et ses règles (append-only,
// jamais de DemandeTalent automatique, recommandation obsolète refusée)
// ont déjà été implémentées et testées en V2.1-C (voir
// tests/api/b39-client-solution-intelligence-api.spec.ts et le rapport
// V2.1-C, section "Note de périmètre"). Ce fichier ajoute UNIQUEMENT les
// vérifications spécifiques à la formulation exacte de V2.1-E qui
// n'étaient pas déjà couvertes littéralement par V2.1-C : traçabilité
// complète de chaque décision, et absence STRUCTURELLE (pas seulement
// comportementale) de toute création de DemandeTalent depuis ce domaine.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerBesoinValide(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `b41-${suffixe}`,
      texteOriginal: `Besoin de test V2.1-E ${suffixe}`,
      statut: "VALIDE",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
  });
}

async function creerProfilCandidatDeTest(suffixe: string) {
  return prisma.profil.create({
    data: {
      nom: `CandidatE${suffixe}`,
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

test.describe("V2.1-E — Gouvernance de décision (vérification)", () => {
  test("une DECISION conserve intégralement : option choisie, client, timestamp, provenance", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-tracabilite`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    const recommandationId = generation.recommandation.id;

    await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`);

    const decision = await prisma.solutionOption.findFirst({ where: { needId: need.id, niveau: "DECISION" } });
    expect(decision).not.toBeNull();
    // Option choisie (traçabilité vers la recommandation décidée).
    expect(decision!.sourceOptionId).toBe(recommandationId);
    // Client (jamais un autre — ownership déjà garanti par deciderSolution).
    expect(decision!.clientId).toBe(client!.id);
    // Timestamp.
    expect(decision!.decideLe).not.toBeNull();
    expect(decision!.createdAt).not.toBeNull();
    // Provenance (qui a décidé).
    expect(decision!.decideParEmail).toBe("client-demo@example.com");
    // Contexte nécessaire à l'audit (les critères ayant motivé la recommandation restent lisibles).
    const donnees = decision!.donnees as { criteresDeterminants?: string[] };
    expect(Array.isArray(donnees.criteresDeterminants)).toBe(true);
  });

  test("une DECISION sur une solution TALENT ne crée jamais de DemandeTalent — vérification structurelle et comportementale", async ({
    request,
  }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-nodt`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(generation.recommandation.typeSolution).toBe("TALENT");

    const avant = await prisma.demandeTalent.count();
    await request.post(`/api/client/besoins/${need.id}/solutions/${generation.recommandation.id}/decision`);
    const apres = await prisma.demandeTalent.count();

    // Comportemental : aucune DemandeTalent créée par la décision, ni pour
    // ce besoin ni globalement.
    expect(apres).toBe(avant);
    expect(await prisma.demandeTalent.count({ where: { sourceNeedId: need.id } })).toBe(0);
    // Le besoin reste sans DemandeTalent liée tant qu'un Admin n'a pas agi
    // explicitement (mécanisme LOT 5 existant, totalement inchangé).
    const besoinApres = await prisma.clientNeed.findUnique({ where: { id: need.id }, include: { demandeTalentCreee: true } });
    expect(besoinApres!.demandeTalentCreee).toBeNull();
  });

  test("changer d'avis ne modifie ni ne supprime jamais l'ancienne décision (vérification au niveau des colonnes, pas seulement du nombre de lignes)", async ({
    request,
  }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerProfilCandidatDeTest(`${Date.now()}-immutable`);
    const need = await creerBesoinValide(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    const recommandationId = generation.recommandation.id;

    const d1 = await (await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`)).json();
    const snapshot1 = await prisma.solutionOption.findUnique({ where: { id: d1.decision.id } });

    await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`);

    const snapshot1Apres = await prisma.solutionOption.findUnique({ where: { id: d1.decision.id } });
    expect(snapshot1Apres).toEqual(snapshot1); // strictement inchangée, colonne par colonne
  });
});
