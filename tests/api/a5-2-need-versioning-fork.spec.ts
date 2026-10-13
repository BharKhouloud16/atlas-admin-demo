import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// ATLAS — A5.2 : Need Versioning Core (fork atomique, chaîne linéaire,
// immutabilité historique, copie des facts ACTIVE, garde SolutionOption).
// Couvre exactement le périmètre verrouillé par "A5.1 — FINAL ARCHITECTURE
// DECISION" et implémenté par "A5.2 — IMPLEMENTATION DU VERSIONING CORE" —
// via les routes réelles /api/client/besoins/[id], .../faits,
// .../solutions/[optionId]/decision.
//
// EXPLICITEMENT NON TESTÉ ICI (hors périmètre A5.2, decision A5.1 §17bis
// non prise) : suppression ou remplacement ciblé d'une instance précise
// d'une clé répétable (COMPETENCE, CONTRAINTE, CRITERE_REUSSITE, PRIORITE,
// RISQUE, PREFERENCE).

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

async function creerBesoinValideDirect(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a52-${suffixe}`,
      texteOriginal: `Besoin de test A5.2 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
    include: { faits: true },
  });
}

async function creerCandidatExploitable(suffixe: string) {
  return prisma.profil.create({
    data: {
      nom: `CandidatA52${suffixe}`,
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

test.describe("A5.2 — Schema : contrainte anti-bifurcation", () => {
  test("plusieurs ClientNeed racines (needParentId=NULL) restent autorisés", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const a = await creerBesoinValideDirect(client!.id);
    const b = await creerBesoinValideDirect(client!.id);
    expect(a.needParentId).toBeNull();
    expect(b.needParentId).toBeNull();
  });

  test("un second enfant pour le même parent est rejeté par la contrainte DB", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const parent = await creerBesoinValideDirect(client!.id);
    await prisma.clientNeed.create({
      data: { clientId: client!.id, correlationId: `a52-enfant1-${Date.now()}`, texteOriginal: "enfant 1", needParentId: parent.id },
    });
    await expect(
      prisma.clientNeed.create({
        data: { clientId: client!.id, correlationId: `a52-enfant2-${Date.now()}`, texteOriginal: "enfant 2", needParentId: parent.id },
      })
    ).rejects.toThrow();
  });
});

test.describe("A5.2 — PATCH : fork simple sur titre", () => {
  test("VALIDATED + titre modifié -> V2 créée, V1 devient historique et immuable, V2 current avec version=2", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "Nouveau titre V2" } });
    expect(patch.status(), await patch.text()).toBe(200);
    const corps = await patch.json();
    const v2 = corps.besoin;

    expect(v2.id).not.toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(v2.needParentId).toBe(v1.id);
    expect(v2.needSuivantId).toBeNull();
    expect(v2.titre).toBe("Nouveau titre V2");
    expect(v2.lifecycleStatut).toBe("VALIDATED");

    const v1Relu = await prisma.clientNeed.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1Relu.needSuivantId).toBe(v2.id);
    expect(v1Relu.titre).toBeNull(); // jamais modifié
    expect(v1Relu.version).toBe(1);
  });

  test("les facts ACTIVE de V1 sont copiés sur V2 avec de nouveaux IDs, jamais réutilisés, valeurs identiques, source inchangée", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [
      { cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" },
      { cle: "BUDGET_MONTANT", valeur: "5000", statut: "VERIFIE" },
    ]);

    let request = await connecter("CLIENT");
    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    expect(patch.status()).toBe(200);
    const v2 = (await patch.json()).besoin;

    expect(v2.faits.length).toBe(2);
    const idsV1 = v1.faits.map((f) => f.id);
    for (const faitV2 of v2.faits) {
      expect(idsV1).not.toContain(faitV2.id); // jamais réutilisé
      expect(faitV2.statutActivite).toBe("ACTIVE");
    }
    expect(v2.faits.find((f: { cle: string }) => f.cle === "LOCALISATION")?.valeur).toBe("Paris");
    expect(v2.faits.find((f: { cle: string }) => f.cle === "BUDGET_MONTANT")?.valeur).toBe("5000");

    // Les lignes source (V1) restent inchangées après le fork.
    const faitsV1Relus = await prisma.clientNeedFait.findMany({ where: { needId: v1.id } });
    expect(faitsV1Relus.length).toBe(2);
    expect(faitsV1Relus.map((f) => f.valeur).sort()).toEqual(["5000", "Paris"]);
  });
});

test.describe("A5.2 — Fork successif (chaîne V1 -> V2 -> V3)", () => {
  test("V1 et V2 deviennent historiques, V3 seule current ; V1/V2 refusent toute modification", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const patch1 = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    expect(patch1.status()).toBe(200);
    const v2 = (await patch1.json()).besoin;

    const patch2 = await request.fetch(`/api/client/besoins/${v2.id}`, { method: "PATCH", data: { titre: "V3" } });
    expect(patch2.status()).toBe(200);
    const v3 = (await patch2.json()).besoin;

    expect(v3.version).toBe(3);
    expect(v3.needParentId).toBe(v2.id);
    expect(v3.needSuivantId).toBeNull();

    const v1Relu = await prisma.clientNeed.findUniqueOrThrow({ where: { id: v1.id } });
    const v2Relu = await prisma.clientNeed.findUniqueOrThrow({ where: { id: v2.id } });
    expect(v1Relu.needSuivantId).toBe(v2.id);
    expect(v2Relu.needSuivantId).toBe(v3.id);

    // Immutabilité : PATCH et POST fait refusés sur V1 (racine) ET V2 (intermédiaire).
    const patchV1 = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "interdit" } });
    expect(patchV1.status()).toBe(409);
    const patchV2 = await request.fetch(`/api/client/besoins/${v2.id}`, { method: "PATCH", data: { titre: "interdit" } });
    expect(patchV2.status()).toBe(409);
    const faitV1 = await request.post(`/api/client/besoins/${v1.id}/faits`, { data: { cle: "LOCALISATION", action: "CONFIRMER" } });
    expect(faitV1.status()).toBe(409);
    const faitV2 = await request.post(`/api/client/besoins/${v2.id}/faits`, { data: { cle: "LOCALISATION", action: "CONFIRMER" } });
    expect(faitV2.status()).toBe(409);
  });
});

test.describe("A5.2 — POST faits : fork sur correction/confirmation", () => {
  test("CORRIGER sur VALIDATED current -> fork ; la correction est posée sur V2, jamais sur V1", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [
      { cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" },
      { cle: "BUDGET_MONTANT", valeur: "5000", statut: "VERIFIE" },
    ]);

    let request = await connecter("CLIENT");
    const reponse = await request.post(`/api/client/besoins/${v1.id}/faits`, {
      data: { cle: "LOCALISATION", action: "CORRIGER", valeur: "Lyon" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    const v2 = corps.besoin;

    expect(v2.id).not.toBe(v1.id);
    expect(v2.needParentId).toBe(v1.id);

    const dernierLocalisationV2 = v2.faits.filter((f: { cle: string }) => f.cle === "LOCALISATION");
    expect(dernierLocalisationV2.length).toBe(1);
    expect(dernierLocalisationV2[0].valeur).toBe("Lyon");
    expect(v2.faits.find((f: { cle: string }) => f.cle === "BUDGET_MONTANT")?.valeur).toBe("5000");

    // V1 n'a jamais reçu la correction — aucun nouveau fait créé sur V1.
    const faitsV1Relus = await prisma.clientNeedFait.findMany({ where: { needId: v1.id } });
    expect(faitsV1Relus.length).toBe(2);
    expect(faitsV1Relus.some((f) => f.valeur === "Lyon")).toBe(false);
  });

  test("facts répétables : V1{A,B} -> fork ajout C -> V2{A,B,C}, jamais collapsés à une seule instance", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [
      { cle: "COMPETENCE", valeur: "A", statut: "DECLARE" },
      { cle: "COMPETENCE", valeur: "B", statut: "DECLARE" },
      { cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" },
    ]);

    let request = await connecter("CLIENT");
    // CLES_CLARIFIABLES exclut les clés répétables — le fork est déclenché
    // via une correction sur une clé non-répétable (LOCALISATION), et l'on
    // vérifie que les 2 instances de COMPETENCE sont TOUTES DEUX copiées
    // sur V2, sans collapse.
    const reponse = await request.post(`/api/client/besoins/${v1.id}/faits`, {
      data: { cle: "LOCALISATION", action: "CORRIGER", valeur: "Lyon" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const v2 = (await reponse.json()).besoin;

    const competencesV2 = v2.faits.filter((f: { cle: string }) => f.cle === "COMPETENCE").map((f: { valeur: string }) => f.valeur);
    expect(competencesV2.sort()).toEqual(["A", "B"]);
  });
});

test.describe("A5.2 — Concurrence : deux forks simultanés sur la même version courante", () => {
  test("une seule branche réussit (V1->V2 OU V1->V3), jamais les deux ; l'autre reçoit 409", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");

    const [reponseA, reponseB] = await Promise.all([
      request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "Tentative A" } }),
      request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "Tentative B" } }),
    ]);

    const statuts = [reponseA.status(), reponseB.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enfants = await prisma.clientNeed.findMany({ where: { needParentId: v1.id } });
    expect(enfants.length).toBe(1); // aucune bifurcation, jamais deux enfants pour V1

    const v1Relu = await prisma.clientNeed.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1Relu.needSuivantId).toBe(enfants[0].id);
  });
});

test.describe("A5.2 — Immutabilité (cas isolés)", () => {
  test("PATCH statut=ARCHIVE sur une version historique -> 409", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id);
    let request = await connecter("CLIENT");
    const patch1 = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    expect(patch1.status()).toBe(200);

    const archiveV1 = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { statut: "ARCHIVE" } });
    expect(archiveV1.status()).toBe(409);
  });

  test("PATCH statut=ARCHIVE seul sur une version courante VALIDATED reste in-place (pas de fork pour une transition de lifecycle pure)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id);
    let request = await connecter("CLIENT");

    const archive = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { statut: "ARCHIVE" } });
    expect(archive.status(), await archive.text()).toBe(200);
    const corps = await archive.json();
    expect(corps.besoin.id).toBe(v1.id); // même id, pas de fork
    expect(corps.besoin.needParentId).toBeNull();

    const enfants = await prisma.clientNeed.findMany({ where: { needParentId: v1.id } });
    expect(enfants.length).toBe(0);
  });
});

test.describe("A5.2 — SolutionOption : garde de version courante", () => {
  test("décision sur une recommandation de V1 refusée après fork vers V2 (409 RECOMMANDATION_OBSOLETE)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerCandidatExploitable(`${Date.now()}-a52-v1`);
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const generation = await (await request.get(`/api/client/besoins/${v1.id}/solutions`)).json();
    expect(generation.eligible).toBe(true);
    expect(generation.recommandation).not.toBeNull();
    const recommandationId = generation.recommandation.id;

    // Fork V1 -> V2 (titre).
    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    expect(patch.status()).toBe(200);

    const decision = await request.post(`/api/client/besoins/${v1.id}/solutions/${recommandationId}/decision`);
    expect(decision.status(), await decision.text()).toBe(409);

    const decisionsEnBase = await prisma.solutionOption.count({ where: { needId: v1.id, niveau: "DECISION" } });
    expect(decisionsEnBase).toBe(0);
  });

  test("décision sur V2 (version courante) fonctionne normalement si les autres conditions sont satisfaites", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerCandidatExploitable(`${Date.now()}-a52-v2`);
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    expect(patch.status()).toBe(200);
    const v2Id = (await patch.json()).besoin.id;

    const generation = await (await request.get(`/api/client/besoins/${v2Id}/solutions`)).json();
    expect(generation.eligible).toBe(true);
    expect(generation.recommandation).not.toBeNull();

    const decision = await request.post(`/api/client/besoins/${v2Id}/solutions/${generation.recommandation.id}/decision`);
    expect(decision.status(), await decision.text()).toBe(200);
  });
});

test.describe("A5.2 — IDOR (isolation Client A / Client B) sur le versioning", () => {
  test("Client A ne peut ni lire, ni PATCH, ni forker, ni ajouter un fait, ni décider sur une version appartenant à Client B", async () => {
    const clientB = await prisma.client.create({ data: { nom: `Client Test A5.2 IDOR ${Date.now()}` } });
    await creerCandidatExploitable(`${Date.now()}-a52-idor`);
    const v1B = await creerBesoinValideDirect(clientB.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");

    const lecture = await request.get(`/api/client/besoins/${v1B.id}`);
    expect(lecture.status()).toBe(404);

    const patch = await request.fetch(`/api/client/besoins/${v1B.id}`, { method: "PATCH", data: { titre: "usurpation" } });
    expect(patch.status()).toBe(404);

    const fait = await request.post(`/api/client/besoins/${v1B.id}/faits`, { data: { cle: "LOCALISATION", action: "CORRIGER", valeur: "Lyon" } });
    expect(fait.status()).toBe(404);

    // Aucun fork n'a eu lieu côté Client B.
    const v1BRelu = await prisma.clientNeed.findUniqueOrThrow({ where: { id: v1B.id } });
    expect(v1BRelu.needSuivantId).toBeNull();

    const solutionsB = await prisma.solutionOption.findFirst({ where: { needId: v1B.id, niveau: "RECOMMANDATION" } });
    if (solutionsB) {
      const decision = await request.post(`/api/client/besoins/${v1B.id}/solutions/${solutionsB.id}/decision`);
      expect(decision.status()).toBe(404);
    }
  });
});
