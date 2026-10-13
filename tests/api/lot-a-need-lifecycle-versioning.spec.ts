import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// ATLAS — LOT A : Need Lifecycle canonique (A2), NeedFactStatus (A1),
// Need versioning / SolutionOption.versionLien (A5). Couvre exactement le
// périmètre verrouillé par le gate "LOT A0 DESIGN FREEZE" et implémenté par
// "LOT A — IMPLEMENTATION" — via les routes réelles /api/client/besoins* et
// /api/client/besoins/[id]/solutions*, jamais un test unitaire déguisé.
//
// Les tests de dernierFaitParCle (filtrage statutActivite=ACTIVE) vivent
// dans tests/unit/client-need-faits.spec.ts — non dupliqués ici.

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

async function creerBesoin(request: APIRequestContext, texteOriginal: string, titre?: string) {
  const reponse = await request.post("/api/client/besoins", { data: { texteOriginal, titre } });
  expect(reponse.status(), await reponse.text()).toBe(201);
  const { besoin } = await reponse.json();
  return besoin as {
    id: string;
    clientId: string;
    statut: string;
    lifecycleStatut: string;
    legacyPreInvariant: boolean;
    version: number;
    faits: { id: string; cle: string; valeur: string; statut: string; statutActivite: string }[];
  };
}

async function creerBesoinValideDirect(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `lot-a-${suffixe}`,
      texteOriginal: `Besoin de test LOT A ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
  });
}

async function creerCandidatExploitable(suffixe: string) {
  return prisma.profil.create({
    data: {
      nom: `CandidatLotA${suffixe}`,
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

test.describe("LOT A — A1 : NeedFactStatus", () => {
  test("tout nouveau ClientNeedFait créé via l'API est ACTIVE", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "Nous cherchons un développeur Python confirmé pour six mois.");
    expect(besoin.faits.length).toBeGreaterThan(0);
    for (const fait of besoin.faits) {
      expect(fait.statutActivite).toBe("ACTIVE");
    }
  });
});

test.describe("LOT A — A2 : Need Lifecycle canonique", () => {
  test("création : lifecycleStatut = UNDERSTANDING, quelle que soit la complétude de l'extraction (même discipline que statut=SOUMIS)", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "Besoin flou, peu de détails pour l'instant.");
    expect(besoin.statut).toBe("SOUMIS");
    expect(besoin.lifecycleStatut).toBe("UNDERSTANDING");
  });

  test("recalcul serveur (faits) : clarifications restantes -> UNDERSTANDING, aucune clarification restante -> STRUCTURING — dérivé de la MÊME logique que A_CLARIFIER/SOUMIS, jamais un mapping direct", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(
      request,
      "Nous cherchons un développeur Backend Senior avec 6 ans d'expérience, budget 600 EUR/jour fixe, à Paris, disponible début novembre pour 4 mois."
    );
    // L'extraction seule peut déjà couvrir les 6 clés importantes ou non —
    // le test ne présume pas du résultat initial, seulement de la
    // cohérence statut<->lifecycleStatut après le premier recalcul serveur.
    const confirmation = await request.post(`/api/client/besoins/${besoin.id}/faits`, {
      data: { cle: "ROLE", action: "CONFIRMER" },
    });
    // Si ROLE n'a pas encore de valeur actuelle, CONFIRMER échoue (400) —
    // dans ce cas on corrige explicitement pour déclencher le recalcul.
    let releve: { besoin: { statut: string; lifecycleStatut: string } };
    if (confirmation.status() === 400) {
      const correction = await request.post(`/api/client/besoins/${besoin.id}/faits`, {
        data: { cle: "ROLE", action: "CORRIGER", valeur: "Développeur Backend" },
      });
      expect(correction.status(), await correction.text()).toBe(201);
      releve = await correction.json();
    } else {
      expect(confirmation.status(), await confirmation.text()).toBe(201);
      releve = await confirmation.json();
    }
    if (releve.besoin.statut === "SOUMIS") {
      expect(releve.besoin.lifecycleStatut).toBe("STRUCTURING");
    } else if (releve.besoin.statut === "A_CLARIFIER") {
      expect(releve.besoin.lifecycleStatut).toBe("UNDERSTANDING");
    }
  });

  test("recalcul serveur : besoin volontairement incomplet -> A_CLARIFIER + UNDERSTANDING, jamais STRUCTURING", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "On a besoin de quelqu'un.");
    const correction = await request.post(`/api/client/besoins/${besoin.id}/faits`, {
      data: { cle: "ROLE", action: "CORRIGER", valeur: "Ingénieur QA" },
    });
    expect(correction.status(), await correction.text()).toBe(201);
    const { besoin: releve } = await correction.json();
    // Un seul champ important renseigné sur six -> des clarifications
    // restent nécessairement dues (MANQUANT sur les 5 autres).
    expect(releve.statut).toBe("A_CLARIFIER");
    expect(releve.lifecycleStatut).toBe("UNDERSTANDING");
  });

  test("PATCH statut=VALIDE -> lifecycleStatut=VALIDATED", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "Nous cherchons un ingénieur DevOps pour un projet cloud.");
    const valide = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "VALIDE" } });
    expect(valide.status(), await valide.text()).toBe(200);
    const { besoin: releve } = await valide.json();
    expect(releve.statut).toBe("VALIDE");
    expect(releve.lifecycleStatut).toBe("VALIDATED");
  });

  test("PATCH statut=ARCHIVE -> lifecycleStatut=ARCHIVED", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "Besoin abandonné, projet reporté.");
    const archive = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "ARCHIVE" } });
    expect(archive.status(), await archive.text()).toBe(200);
    const { besoin: releve } = await archive.json();
    expect(releve.statut).toBe("ARCHIVE");
    expect(releve.lifecycleStatut).toBe("ARCHIVED");
  });

  test("jamais de retour à DRAFT (règle inchangée, vérifiée pour les deux vocabulaires en dual-read)", async () => {
    let request = await connecter("CLIENT");
    const besoin = await creerBesoin(request, "Besoin pour vérifier l'interdiction de retour en brouillon.");
    const retourBrouillon = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "BROUILLON" } });
    expect(retourBrouillon.status()).toBe(400);
  });

  test("IDOR — un besoin d'un autre client reste 404 (jamais une fuite d'existence), lifecycleStatut inclus sans régression d'isolation", async () => {
    const clientB = await prisma.client.create({ data: { nom: `Client Test LOT A IDOR ${Date.now()}` } });
    const besoinClientB = await creerBesoinValideDirect(clientB.id);

    let request = await connecter("CLIENT");
    const lecture = await request.get(`/api/client/besoins/${besoinClientB.id}`);
    expect(lecture.status()).toBe(404);

    const patch = await request.fetch(`/api/client/besoins/${besoinClientB.id}`, { method: "PATCH", data: { statut: "ARCHIVE" } });
    expect(patch.status()).toBe(404);
  });
});

test.describe("LOT A — A5 : SolutionOption.versionLien / correctif du filtrage par vague", () => {
  test("une nouvelle génération pose versionLien = signature courante sur chaque ligne (OPTION et RECOMMANDATION)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerCandidatExploitable(`${Date.now()}-versionlien`);
    const need = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();

    expect(generation.eligible).toBe(true);
    expect(typeof generation.signatureActuelle).toBe("string");
    expect(generation.signatureActuelle.length).toBeGreaterThan(0);
    if (generation.recommandation) {
      expect(generation.recommandation.versionLien).toBe(generation.signatureActuelle);
    }
    for (const option of generation.options) {
      expect(option.versionLien).toBe(generation.signatureActuelle);
    }
  });

  test("décider sur une recommandation dont le besoin a changé depuis (versionLien désynchronisé, sans nouvelle vague générée) est refusé — 409 RECOMMANDATION_OBSOLETE", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerCandidatExploitable(`${Date.now()}-obsolete`);
    const need = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const generation = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(generation.eligible).toBe(true);
    expect(generation.recommandation).not.toBeNull();
    const recommandationId = generation.recommandation.id;

    // Simule un changement du besoin survenu APRÈS la génération mais SANS
    // qu'une nouvelle vague ait encore été déclenchée (écriture directe,
    // hors du chemin normal /api/client/besoins/[id]/faits — exactement le
    // scénario que versionLien doit couvrir, distinct du contrôle
    // "recommandation la plus récente" déjà existant).
    await prisma.clientNeedFait.create({
      data: { needId: need.id, cle: "COMPETENCE", valeur: "Terraform", statut: "DECLARE" },
    });

    const decision = await request.post(`/api/client/besoins/${need.id}/solutions/${recommandationId}/decision`);
    expect(decision.status(), await decision.text()).toBe(409);

    // Aucune DECISION n'a été créée — jamais une décision silencieuse sur
    // une base obsolète.
    const decisionsEnBase = await prisma.solutionOption.count({ where: { needId: need.id, niveau: "DECISION" } });
    expect(decisionsEnBase).toBe(0);
  });

  test("le chemin idempotent (\"rien n'a changé\") ne renvoie que les OPTION de la vague courante, jamais mélangées avec une vague antérieure", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await creerCandidatExploitable(`${Date.now()}-vague`);
    const need = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);

    let request = await connecter("CLIENT");
    const premiereGeneration = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(premiereGeneration.eligible).toBe(true);
    const signatureInitiale = premiereGeneration.signatureActuelle;

    // Deuxième appel sans aucun changement -> chemin idempotent.
    const deuxiemeGeneration = await (await request.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(deuxiemeGeneration.signatureActuelle).toBe(signatureInitiale);
    for (const option of deuxiemeGeneration.options) {
      expect(option.versionLien).toBe(signatureInitiale);
    }
  });
});
