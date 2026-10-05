import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Couvre : accessibilité RESULTAT_ATTENDU/CRITERE_REUSSITE par le parcours
// produit réel ; OutcomeAssessment (statuts, règle absolue "jamais
// inventé"), séparation Evaluation/Mission.TERMINEE/Outcome, versioning
// (point-in-time truth A5.2), sécurité (RBAC/IDOR/immutabilité), données
// manquantes/historiques, idempotence/concurrence.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Ingénieur Test A6.1 ${suffixe}` } });
}

async function creerNeedAvecFaits(clientId: string, faits: { cle: string; valeur: string; statut?: string }[]) {
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a6-1-${Date.now()}-${Math.random()}`,
      texteOriginal: "Besoin de test A6.1 — Outcome Foundation.",
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: (f.statut ?? "DECLARE") as never, source: "test" })) },
    },
    include: { faits: true },
  });
}

async function creerDemandeEtMission(
  request: APIRequestContext,
  clientId: string,
  needId: string | null
): Promise<{ missionId: string; demandeId: string | null }> {
  const demande = needId
    ? await prisma.demandeTalent.create({ data: { clientId, description: `Demande A6.1 ${Date.now()}`, sourceNeedId: needId } })
    : null;
  const profil = await creerProfil();
  const creation = await request.post("/api/missions", {
    data: demande
      ? { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 10, tjmVente: 500 }
      : { clientId, profilId: profil.id, nbJours: 10, tjmVente: 500 },
  });
  expect(creation.status(), await creation.text()).toBe(201);
  const mission = await creation.json();
  return { missionId: mission.id, demandeId: demande?.id ?? null };
}

async function terminer(request: APIRequestContext, missionId: string) {
  const reponse = await request.patch(`/api/missions/${missionId}/transition`, { data: { action: "terminer" } });
  expect(reponse.status(), await reponse.text()).toBe(200);
}

test.describe("COMPANY ATLAS A6.1 — Need readiness (RESULTAT_ATTENDU / CRITERE_REUSSITE)", () => {
  test("RESULTAT_ATTENDU est accessible via le parcours réel : absent -> clarification MANQUANT -> CORRIGER -> présent", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/client/besoins", { data: { texteOriginal: "Nous cherchons un développeur QA pour notre équipe." } });
    expect(creation.status(), await creation.text()).toBe(201);
    const besoin = (await creation.json()).besoin;
    // Absence rendue EXPLICITE (ligne INCONNU, valeur vide — voir
    // CLES_IMPORTANTES_SI_ABSENTES) plutôt que silencieuse : même mécanisme
    // que ROLE/SENIORITE/etc., jamais une valeur inventée.
    const avant = besoin.faits.find((f: { cle: string }) => f.cle === "RESULTAT_ATTENDU");
    expect(avant?.statut).toBe("INCONNU");
    expect(avant?.valeur).toBe("");

    const correction = await request.post(`/api/client/besoins/${besoin.id}/faits`, {
      data: { cle: "RESULTAT_ATTENDU", action: "CORRIGER", valeur: "Réduire le taux de bugs en production de 50%." },
    });
    expect(correction.status(), await correction.text()).toBe(201);
    const apres = (await correction.json()).besoin;
    // Historique additif (LOT 3) : la ligne INCONNU initiale reste en base,
    // la nouvelle ligne DECLARE est ajoutée à côté — la valeur ACTUELLE est
    // la plus récente par createdAt (même résolution que dernierFaitParCle).
    const toutesLesLignes = apres.faits.filter((f: { cle: string }) => f.cle === "RESULTAT_ATTENDU");
    const derniere = [...toutesLesLignes].sort(
      (a: { createdAt: string }, b: { createdAt: string }) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ).pop();
    expect(derniere?.valeur).toBe("Réduire le taux de bugs en production de 50%.");
    expect(derniere?.statut).toBe("VERIFIE");
  });

  test("CRITERE_REUSSITE répétable reste accessible dès l'extraction initiale, plusieurs instances distinctes jamais collapsées", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/client/besoins", {
      data: { texteOriginal: "Critères de réussite : couverture de tests supérieure à 90% et aucun défaut critique ouvert." },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const besoin = (await creation.json()).besoin;
    const criteres = besoin.faits.filter((f: { cle: string }) => f.cle === "CRITERE_REUSSITE");
    expect(criteres.length).toBeGreaterThanOrEqual(2);
  });

  test("CORRIGER sur une clé répétable (CRITERE_REUSSITE) reste refusé (400) — le périmètre LOT 3 n'est pas réouvert par A6.1", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/client/besoins", { data: { texteOriginal: "Nous cherchons un développeur QA." } });
    const besoin = (await creation.json()).besoin;
    const reponse = await request.post(`/api/client/besoins/${besoin.id}/faits`, {
      data: { cle: "CRITERE_REUSSITE", action: "CORRIGER", valeur: "Nouveau critère ajouté manuellement" },
    });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("COMPANY ATLAS A6.1 — OutcomeAssessment : statuts et règle absolue", () => {
  test("aucun CRITERE_REUSSITE disponible -> overallStatus INDETERMINABLE, jamais inventé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "OBJECTIF", valeur: "x" }]);
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { outcome } = await reponse.json();
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
    expect(outcome.criteria).toHaveLength(0);
  });

  test("critère proposé OBTENU sans aucune preuve -> forcé à INDETERMINABLE (règle absolue, jamais une invention)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Couverture >= 90%" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: [], evidences: [] }] },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { outcome } = await reponse.json();
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
    expect(outcome.criteria[0].status).toBe("INDETERMINABLE");
  });

  test("critère vérifié humainement avec preuve -> OBTENU réellement retenu", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Livraison avant fin de mois" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: {
        verdicts: [
          { sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "Constat Admin du livrable" }] },
        ],
      },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { outcome } = await reponse.json();
    expect(outcome.overallStatus).toBe("OBTENU");
    expect(outcome.criteria[0].confidence).toBe("VERIFIE");
  });

  test("verdict référençant un critère n'appartenant pas à la version du Need évaluée -> 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère réel" }]);
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: "id-invente-xyz", statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("COMPANY ATLAS A6.1 — Séparation Mission.TERMINEE / Evaluation / Outcome", () => {
  test("Mission.TERMINEE n'implique jamais Outcome=OBTENU — précondition, jamais une conséquence automatique", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, null);
    await terminer(request, missionId);

    const lecture = await request.get(`/api/missions/${missionId}/outcome`);
    expect(lecture.status(), await lecture.text()).toBe(200);
    const { outcome } = await lecture.json();
    expect(outcome).toBeNull();
  });

  test("POST /outcome refusé (409) tant que la mission n'est pas TERMINEE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, null);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(reponse.status()).toBe(409);
  });

  test("Evaluation 5/5 + Outcome NON_OBTENU sont tous les deux valides simultanément (satisfaction ≠ résultat objectif)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Zero défaut critique" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    await connecter(request, "client-demo@example.com");
    const evaluation = await request.post("/api/evaluations", { data: { missionId, note: 5 } });
    expect(evaluation.status(), await evaluation.text()).toBe(201);

    await connecter(request, "admin-demo@example.com");
    const outcomeReponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "NON_OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "Défaut critique trouvé en prod" }] }] },
    });
    expect(outcomeReponse.status(), await outcomeReponse.text()).toBe(201);
    const { outcome } = await outcomeReponse.json();
    expect(outcome.overallStatus).toBe("NON_OBTENU");

    const evalEnBase = await prisma.evaluation.findUnique({ where: { missionId } });
    expect(evalEnBase?.note).toBe(5);
  });

  test("Evaluation 3/5 + Outcome OBTENU sont tous les deux valides simultanément", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Livré à temps" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    await connecter(request, "client-demo@example.com");
    const evaluation = await request.post("/api/evaluations", { data: { missionId, note: 3 } });
    expect(evaluation.status(), await evaluation.text()).toBe(201);

    await connecter(request, "admin-demo@example.com");
    const outcomeReponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "Livré dans les temps, constaté" }] }] },
    });
    expect(outcomeReponse.status(), await outcomeReponse.text()).toBe(201);
    const { outcome } = await outcomeReponse.json();
    expect(outcome.overallStatus).toBe("OBTENU");
  });
});

test.describe("COMPANY ATLAS A6.1 — Versioning (point-in-time truth, A5.2)", () => {
  test("Outcome créé sur Need V1 reste attaché à V1 après un fork vers V2 — jamais réinterprété selon V2", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const creation = await request.post("/api/client/besoins", { data: { texteOriginal: "Besoin de test versioning A6.1." } });
    const besoinV1 = (await creation.json()).besoin;
    await request.fetch(`/api/client/besoins/${besoinV1.id}`, { method: "PATCH", data: { statut: "VALIDE" } });

    await prisma.clientNeedFait.create({
      data: { needId: besoinV1.id, cle: "CRITERE_REUSSITE", valeur: "Critère V1 figé", statut: "DECLARE", source: "test" },
    });
    const faitV1 = await prisma.clientNeedFait.findFirst({ where: { needId: besoinV1.id, cle: "CRITERE_REUSSITE" } });

    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, besoinV1.id);
    await terminer(request, missionId);

    const outcomeReponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitV1!.id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "constat" }] }] },
    });
    expect(outcomeReponse.status(), await outcomeReponse.text()).toBe(201);
    const outcomeInitial = (await outcomeReponse.json()).outcome;
    expect(outcomeInitial.needVersionId).toBe(besoinV1.id);

    // Fork V1 -> V2 (titre modifié sur un besoin VALIDATED courant, A5.2).
    await connecter(request, "client-demo@example.com");
    const fork = await request.fetch(`/api/client/besoins/${besoinV1.id}`, { method: "PATCH", data: { titre: "Titre modifié post-validation" } });
    expect(fork.status(), await fork.text()).toBe(200);
    const v2 = (await fork.json()).besoin;
    expect(v2.id).not.toBe(besoinV1.id);

    const outcomeApresFork = await prisma.outcomeAssessment.findUnique({ where: { id: outcomeInitial.id } });
    expect(outcomeApresFork?.needVersionId).toBe(besoinV1.id);
    expect(outcomeApresFork?.needVersionId).not.toBe(v2.id);
  });
});

test.describe("COMPANY ATLAS A6.1 — Données manquantes / Missions historiques", () => {
  test("Mission sans aucune chaîne de traçabilité (pas de sourceDemandeId) -> needVersionId null, INDETERMINABLE, jamais une erreur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, null);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { outcome } = await reponse.json();
    expect(outcome.needVersionId).toBeNull();
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
  });

  test("absence de toute évaluation jamais tentée (pas de ligne) se distingue d'une ligne INDETERMINABLE existante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, []);
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const avant = await request.get(`/api/missions/${missionId}/outcome`);
    expect((await avant.json()).outcome).toBeNull();

    await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });

    const apres = await request.get(`/api/missions/${missionId}/outcome`);
    const { outcome } = await apres.json();
    expect(outcome).not.toBeNull();
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
  });
});

test.describe("COMPANY ATLAS A6.1 — Sécurité (RBAC / IDOR / immutabilité)", () => {
  test("CLIENT ne peut jamais créer d'Outcome, même sur sa propre mission (403)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, null);
    await terminer(request, missionId);

    await connecter(request, "client-demo@example.com");
    const reponse = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(reponse.status()).toBe(403);
  });

  test("INGENIEUR ne peut ni créer ni lire un Outcome (403)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const { missionId } = await creerDemandeEtMission(request, client!.id, null);
    await terminer(request, missionId);

    await connecter(request, "ingenieur-demo@example.com");
    const lecture = await request.get(`/api/missions/${missionId}/outcome`);
    expect(lecture.status()).toBe(403);
    const creation = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(creation.status()).toBe(403);
  });

  test("IDOR — un Client ne peut jamais lire l'Outcome de la mission d'un autre client (404, jamais une fuite)", async ({ request }) => {
    // Même patron que tests/api/b39-client-solution-intelligence-api.spec.ts :
    // un second Client est créé directement via Prisma (aucun User/login
    // associé n'est nécessaire — seul client-demo authentifié tente d'y
    // accéder, jamais le second client lui-même).
    const autreClient = await prisma.client.create({ data: { nom: `Client Test A6.1 IDOR ${Date.now()}` } });
    await connecter(request, "admin-demo@example.com");
    const { missionId } = await creerDemandeEtMission(request, autreClient.id, null);
    await terminer(request, missionId);

    const outcomeReponse = await request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts: [] } });
    expect(outcomeReponse.status(), await outcomeReponse.text()).toBe(201);

    await connecter(request, "client-demo@example.com");
    const lecture = await request.get(`/api/missions/${missionId}/outcome`);
    expect(lecture.status()).toBe(404);
  });

  test("Outcome finalisé immuable — un second POST crée une NOUVELLE ligne (supersession), jamais une modification en place de l'ancienne", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère réévaluable" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const premiere = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "constat initial" }] }] },
    });
    const outcome1 = (await premiere.json()).outcome;

    const seconde = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "NON_OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "défaut découvert ensuite" }] }] },
    });
    const outcome2 = (await seconde.json()).outcome;

    expect(outcome2.id).not.toBe(outcome1.id);

    // A15 — le pointeur de succession vit sur la NOUVELLE ligne (supersedesId),
    // jamais sur l'ancienne : outcome1 ne porte plus aucune trace de sa
    // supersession, seul outcome2 référence outcome1.
    const ancienneLigne = await prisma.outcomeAssessment.findUnique({ where: { id: outcome1.id } });
    expect(ancienneLigne?.overallStatus).toBe("OBTENU"); // jamais modifiée en place
    expect(ancienneLigne?.supersedesId).toBeNull(); // outcome1 n'a jamais été réécrite

    expect(outcome2.supersedesId).toBe(outcome1.id);

    const courant = await request.get(`/api/missions/${missionId}/outcome`);
    expect((await courant.json()).outcome.id).toBe(outcome2.id);
  });

  test("idempotence/concurrence — deux créations concurrentes ne laissent jamais deux lignes courantes simultanées", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère concurrence" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const verdicts = [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }];
    const [r1, r2] = await Promise.all([
      request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts } }),
      request.post(`/api/missions/${missionId}/outcome`, { data: { verdicts } }),
    ]);
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);

    const lignesCourantes = await prisma.outcomeAssessment.count({ where: { missionId, supersededBy: null } });
    expect(lignesCourantes).toBe(1);
    const total = await prisma.outcomeAssessment.count({ where: { missionId } });
    expect(total).toBe(2);
  });
});

// A15 — Correction architecturale de la supersession OutcomeAssessment
// (même doctrine que DeliveryEvidence, A12.1) : le pointeur de succession
// vit désormais sur la NOUVELLE ligne (supersedesId), jamais sur
// l'ancienne. Les tests ci-dessous couvrent exactement les 8 invariants
// mandatés par A15 §5/§7.
test.describe("A15 — OutcomeAssessment : supersession corrigée (supersedesId sur le successeur)", () => {
  test("création initiale — supersedesId=null, aucune supersession", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère A15-1" }]);
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const reponse = await request.post(`/api/missions/${missionId}/outcome`, {
      data: { verdicts: [{ sourceFaitId: need.faits[0].id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });
    const o1 = (await reponse.json()).outcome;
    expect(o1.supersedesId).toBeNull();
  });

  test("chaîne O1 ← O2 ← O3 — current correct à chaque étape, aucune mutation des prédécesseurs, aucune branche", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère A15-chaîne" }]);
    const faitId = need.faits[0].id;
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const poster = (statutPropose: string) =>
      request
        .post(`/api/missions/${missionId}/outcome`, {
          data: { verdicts: [{ sourceFaitId: faitId, statutPropose, methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
        })
        .then((r) => r.json())
        .then((b) => b.outcome);

    const avant1 = new Date();
    const o1 = await poster("OBTENU");
    const o2 = await poster("NON_OBTENU");
    const o3 = await poster("PARTIELLEMENT_OBTENU");

    // Chaîne : O2 pointe O1, O3 pointe O2 — jamais l'inverse.
    expect(o2.supersedesId).toBe(o1.id);
    expect(o3.supersedesId).toBe(o2.id);

    // Current après la chaîne complète = O3 uniquement (Test 4 — current).
    const courant = await request.get(`/api/missions/${missionId}/outcome`);
    expect((await courant.json()).outcome.id).toBe(o3.id);
    const compteCourantes = await prisma.outcomeAssessment.count({ where: { missionId, supersededBy: null } });
    expect(compteCourantes).toBe(1);

    // Immutabilité complète d'O1 et O2 après la création de leurs successeurs
    // (Test 3/6) : relecture intégrale (champs scalaires + criteria + evidences),
    // rien ne doit avoir changé depuis leur propre création.
    const o1Relu = await prisma.outcomeAssessment.findUniqueOrThrow({
      where: { id: o1.id },
      include: { criteria: { include: { evidences: true } } },
    });
    expect(o1Relu.supersedesId).toBeNull(); // jamais réécrit pour pointer vers O2
    expect(o1Relu.overallStatus).toBe("OBTENU");
    expect(o1Relu.missionId).toBe(missionId); // Test 8 — Mission pinning
    expect(o1Relu.needVersionId).toBe(o1.needVersionId); // Test 7 — Need pinning (inchangé depuis création)
    expect(o1Relu.createdAt.toISOString()).toBe(o1.createdAt);
    expect(o1Relu.criteria).toHaveLength(1);
    expect(o1Relu.criteria[0].status).not.toBeNull();

    const o2Relu = await prisma.outcomeAssessment.findUniqueOrThrow({ where: { id: o2.id } });
    expect(o2Relu.supersedesId).toBe(o1.id); // posé UNE SEULE FOIS à la création d'O2, jamais réécrit depuis
    expect(o2Relu.overallStatus).toBe("NON_OBTENU");
    expect(o2Relu.missionId).toBe(missionId);
    expect(o2Relu.needVersionId).toBe(o2.needVersionId);
    expect(avant1.getTime()).toBeLessThanOrEqual(o1Relu.createdAt.getTime());

    // Need/Mission pinning à travers toute la chaîne (Test 7/8) : les trois
    // lignes partagent la même Mission et la même version de Need, jamais
    // recalculée dynamiquement.
    expect(o1.needVersionId).toBe(o2.needVersionId);
    expect(o2.needVersionId).toBe(o3.needVersionId);
    expect([o1.missionId, o2.missionId, o3.missionId]).toEqual([missionId, missionId, missionId]);
  });

  test("branchement interdit — deux lignes ne peuvent jamais superséder la même ligne (contrainte unique)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère A15-branche" }]);
    const { missionId } = await creerDemandeEtMission(request, client!.id, need.id);
    await terminer(request, missionId);

    const o1 = await prisma.outcomeAssessment.create({
      data: { missionId, overallStatus: "OBTENU", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
    });

    // Première supersession de O1 — doit réussir.
    await prisma.outcomeAssessment.create({
      data: { missionId, overallStatus: "NON_OBTENU", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN", supersedesId: o1.id },
    });

    // Tentative d'une SECONDE ligne superséder le même O1 — doit être
    // rejetée par la contrainte @@unique sur supersedesId, jamais acceptée
    // silencieusement (interdit toute branche O1 ← {O2, O3}).
    await expect(
      prisma.outcomeAssessment.create({
        data: { missionId, overallStatus: "INDETERMINABLE", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN", supersedesId: o1.id },
      })
    ).rejects.toThrow();
  });
});
