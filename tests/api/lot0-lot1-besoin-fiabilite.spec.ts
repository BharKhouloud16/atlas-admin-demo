import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { creerClientIsole, connecter } from "../setup/donnees-isolees";

// LOT 0 / LOT 1 (28/10/2026) — non-régression des anomalies de recette :
//   ANO-02 : « Solutions possibles » renvoyait 500 (P2028) avec
//            connection_limit=1 — la transaction ne doit plus exécuter de
//            requête hors `tx`, y compris sous appels concurrents ;
//   ANO-03 : toute valeur comprise par ATLAS est corrigeable, les valeurs
//            numériques sont normalisées ou refusées ;
//   ANO-04 : les compétences (clé répétable) s'ajoutent / se retirent une
//            à une, dans la liste fermée du matching.

// REV-03 (01/11/2026) : chaque test utilise son propre client isolé (aucun
// besoin créé sur le compte de démonstration partagé).
async function creerBesoin(clientId: string, statut: "SOUMIS" | "VALIDE", faits: { cle: string; valeur: string; statut: string; source?: string }[]) {
  const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `lot01-${suffixe}`,
      texteOriginal: `Besoin de test lot 0/1 ${suffixe}`,
      statut,
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never, source: f.source ?? "extraction" })) },
    },
  });
}

test.describe("LOT 0 — ANO-02 : Solutions possibles fiables sous connexion unique", () => {
  test("10 appels simultanés : tous en 200, une seule vague d'options, aucune donnée d'identité", async ({ request }) => {
    const { client, email } = await creerClientIsole();
    const suffixe = `${Date.now()}`;
    await prisma.profil.create({
      data: {
        nom: `CandidatLot0${suffixe}`,
        prenom: "Test",
        cvValide: true,
        competences: [`Lot0Comp${suffixe}`],
        competencesGraph: { create: [{ competence: `Lot0Comp${suffixe}`, statut: "VERIFIE", confiance: "HAUTE" }] },
        seniorite: "Senior",
        anneesExperience: 6,
        tjmEstime: 600,
        disponibilite: "Disponible immédiatement",
      },
    });
    const besoin = await creerBesoin(client.id, "VALIDE", [{ cle: "COMPETENCE", valeur: `Lot0Comp${suffixe}`, statut: "DECLARE" }]);
    await connecter(request, email);

    const reponses = await Promise.all(Array.from({ length: 10 }, () => request.get(`/api/client/besoins/${besoin.id}/solutions`)));
    const statuts = reponses.map((r) => r.status());
    expect(statuts, JSON.stringify(statuts)).toEqual(Array(10).fill(200));

    const corps = await Promise.all(reponses.map((r) => r.text()));
    for (const texte of corps) {
      expect(texte).not.toContain(`CandidatLot0${suffixe}`);
      expect(texte).not.toContain("profilId");
    }
    const recommandations = await prisma.solutionOption.count({ where: { needId: besoin.id, niveau: "RECOMMANDATION" } });
    expect(recommandations).toBe(1);
    const premier = JSON.parse(corps[0]);
    expect(premier.eligible).toBe(true);
    expect(premier.options.length).toBeGreaterThanOrEqual(1);
    expect(premier.options.length).toBeLessThanOrEqual(5);
  });

  test("des critères modifiés après une première génération produisent une nouvelle vague, sans erreur", async ({ request }) => {
    const { client, email } = await creerClientIsole();
    const besoin = await creerBesoin(client.id, "VALIDE", [{ cle: "COMPETENCE", valeur: "Ansible", statut: "DECLARE" }]);
    await connecter(request, email);
    expect((await request.get(`/api/client/besoins/${besoin.id}/solutions`)).status()).toBe(200);
    const ajout = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "COMPETENCE", action: "AJOUTER", valeur: "Terraform" } });
    expect(ajout.status()).toBe(201);
    expect((await request.get(`/api/client/besoins/${besoin.id}/solutions`)).status()).toBe(200);
  });
});

test.describe("LOT 1 — correction des valeurs comprises (ANO-03, ANO-04)", () => {
  test("un budget mal compris se corrige ; « 550 € » est normalisé en 550", async ({ request }) => {
    const { client, email } = await creerClientIsole();
    const besoin = await creerBesoin(client.id, "SOUMIS", [{ cle: "BUDGET_MONTANT", valeur: "2027", statut: "DECLARE" }]);
    await connecter(request, email);
    const reponse = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "BUDGET_MONTANT", action: "CORRIGER", valeur: "550 €" } });
    expect(reponse.status()).toBe(201);
    const { besoin: maj } = await reponse.json();
    const budgets = maj.faits.filter((f: { cle: string }) => f.cle === "BUDGET_MONTANT");
    expect(budgets.map((f: { valeur: string; source: string }) => `${f.valeur}/${f.source}`).sort()).toEqual(["2027/extraction", "550/client_correction"]);
  });

  test("un budget non numérique est refusé (400), rien n'est enregistré", async ({ request }) => {
    const { client, email } = await creerClientIsole();
    const besoin = await creerBesoin(client.id, "SOUMIS", []);
    await connecter(request, email);
    const reponse = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "BUDGET_MONTANT", action: "CORRIGER", valeur: "environ cinq cents" } });
    expect(reponse.status()).toBe(400);
    expect(await prisma.clientNeedFait.count({ where: { needId: besoin.id } })).toBe(0);
  });

  test("compétences : ajout, retrait, refus d'une compétence hors liste", async ({ request }) => {
    const { client, email } = await creerClientIsole();
    const besoin = await creerBesoin(client.id, "SOUMIS", [
      { cle: "COMPETENCE", valeur: "Playwright", statut: "DECLARE" },
      { cle: "COMPETENCE", valeur: "Postman", statut: "DECLARE" },
    ]);
    await connecter(request, email);

    const ajout = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "COMPETENCE", action: "AJOUTER", valeur: "Cypress" } });
    expect(ajout.status()).toBe(201);
    const retrait = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "COMPETENCE", action: "RETIRER", valeur: "Postman" } });
    expect(retrait.status()).toBe(201);
    const inconnue = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "COMPETENCE", action: "AJOUTER", valeur: "Compétence inventée" } });
    expect(inconnue.status()).toBe(400);

    const faits = await prisma.clientNeedFait.findMany({ where: { needId: besoin.id, cle: "COMPETENCE" }, orderBy: { createdAt: "asc" } });
    expect(faits.map((f) => `${f.valeur}:${f.statut}`)).toEqual(["Playwright:DECLARE", "Postman:DECLARE", "Cypress:VERIFIE", "Postman:INCONNU"]);
  });

  test("isolation : un client ne corrige jamais le besoin d'un autre client (404)", async ({ request }) => {
    const { email } = await creerClientIsole();
    const autre = await prisma.client.create({ data: { nom: `Client isolation lot1 ${Date.now()}` } });
    const besoin = await creerBesoin(autre.id, "SOUMIS", [{ cle: "BUDGET_MONTANT", valeur: "500", statut: "DECLARE" }]);
    await connecter(request, email);
    const reponse = await request.post(`/api/client/besoins/${besoin.id}/faits`, { data: { cle: "BUDGET_MONTANT", action: "CORRIGER", valeur: "1" } });
    expect(reponse.status()).toBe(404);
    expect(await prisma.clientNeedFait.count({ where: { needId: besoin.id } })).toBe(1);
  });
});
