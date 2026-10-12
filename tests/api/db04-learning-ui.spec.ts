import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-04 : Learning UI (08/10/2026).
//
// Couvre les 20 scénarios obligatoires du mandat DB-04 §23. DB-04 ne
// modifie AUCUNE route/service A30 (app/api/missions/[id]/learning/**,
// lib/learning/learning.ts) — cette suite verrouille le contrat existant
// tel qu'il est réellement consommé par les nouvelles pages
// app/admin/missions/[id]/learning/**, jamais une réimplémentation de
// a30-learning.spec.ts (déjà exhaustif sur le moteur lui-même, inchangé).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable — voir prisma/seed.ts");
  return user.profilId;
}

async function creerProfil() {
  return prisma.profil.create({ data: { nom: `Profil Test DB04 ${Date.now()}-${Math.random()}` } });
}

// `profilId` (legacy) pointe vers ingenieur-demo par défaut, car
// estIngenieurAutoriseSurMission (A26/A27/A29/A30) s'appuie exactement sur
// ce champ — pas sur WorkItemAssignment (contrat DB-01, domaine séparé).
async function creerMission(statut: StatutMission = StatutMission.TERMINEE, profilId?: string) {
  const client = await clientDemo();
  const profil = profilId ?? (await profilIngenieurDemo());
  return prisma.mission.create({
    data: { clientId: client.id, profilId: profil, repere: `Mission Test DB04 ${Date.now()}-${Math.random()}`, nbJours: 10, tjmVente: 500, statut },
  });
}

type CreationLearning = {
  type?: string;
  provenance?: string;
  confidence?: string;
  scope?: string;
  sourceWorkItemId?: string;
};

async function creerLearning(missionId: string, overrides: CreationLearning = {}) {
  return prisma.learning.create({
    data: {
      missionId,
      type: (overrides.type ?? "LESSON") as never,
      title: `Learning Test DB04 ${Date.now()}-${Math.random()}`,
      statement: "Constat factuel de test pour DB-04.",
      provenance: (overrides.provenance ?? "DECLARED") as never,
      confidence: (overrides.confidence ?? "MEDIUM") as never,
      scope: (overrides.scope ?? "MISSION") as never,
      sourceWorkItemId: overrides.sourceWorkItemId,
      createdByEmail: "admin-demo@example.com",
      createdByRole: "ADMIN",
    },
  });
}

test.describe("DB-04 — Consultation / RBAC", () => {
  test("1. ADMIN peut consulter les Learnings d'une Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    await creerLearning(mission.id);
    const reponse = await request.get(`/api/missions/${mission.id}/learning`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).learnings).toHaveLength(1);
  });

  test("2. INGENIEUR respecte les permissions existantes (lecture sur sa propre Mission autorisée)", async ({ request }) => {
    const mission = await creerMission(); // profilId = ingenieur-demo
    await creerLearning(mission.id);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.get(`/api/missions/${mission.id}/learning`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).learnings).toHaveLength(1);
  });

  test("3. CLIENT n'a aucun accès (403)", async ({ request }) => {
    const mission = await creerMission();
    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(`/api/missions/${mission.id}/learning`);
    expect(reponse.status()).toBe(403);
  });

  test("4. Learning cross-tenant (Ingénieur non autorisé sur cette Mission) -> inaccessible", async ({ request }) => {
    const autreProfil = await creerProfil();
    const mission = await creerMission(StatutMission.TERMINEE, autreProfil.id); // jamais ingenieur-demo
    await creerLearning(mission.id);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.get(`/api/missions/${mission.id}/learning`);
    expect(reponse.status()).toBe(404);
  });

  test("5. Learning inexistant -> 404 (convention existante)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const reponse = await request.get(`/api/missions/${mission.id}/learning/inexistant-cuid`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("DB-04 — Données affichées", () => {
  test("6. statut PROPOSE affiché correctement (valeur par défaut, jamais choisie par l'appelant)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).statut).toBe("PROPOSE");
  });

  test("7. statut VALIDE affiché correctement après validation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "valider" } });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).statut).toBe("VALIDE");
  });

  test("8. applicabilite OBSOLETE affichée correctement après marquage", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "marquer_obsolete" } });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).applicabilite).toBe("OBSOLETE");
  });

  test("9. provenance affichée exactement telle que créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id, { provenance: "OBSERVED" });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).provenance).toBe("OBSERVED");
  });

  test("10. confidence affichée exactement telle que créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id, { confidence: "HIGH" });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).confidence).toBe("HIGH");
  });

  test("11. scope affiché exactement tel que créé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id, { scope: "CLIENT" });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    expect((await reponse.json()).scope).toBe("CLIENT");
  });

  test("12. source affichée : exactement le pointeur structuré réellement présent, jamais reconstruite", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: "WorkItem DB04", createdByEmail: "admin-demo@example.com" } });
    const learning = await creerLearning(mission.id, { sourceWorkItemId: workItem.id });
    const reponse = await request.get(`/api/missions/${mission.id}/learning/${learning.id}`);
    const corps = await reponse.json();
    expect(corps.sourceWorkItemId).toBe(workItem.id);
    expect(corps.sourceDeliverableId).toBeNull();
    expect(corps.sourceDeliveryEvidenceId).toBeNull();
  });
});

test.describe("DB-04 — Validation", () => {
  test("13. ADMIN peut valider un Learning PROPOSE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "valider" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("VALIDE");
  });

  test("14. INGENIEUR ne peut pas valider (403, aucune mutation)", async ({ request }) => {
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "valider" } });
    expect(reponse.status()).toBe(403);
    expect((await prisma.learning.findUnique({ where: { id: learning.id } }))?.statut).toBe("PROPOSE");
  });

  test("15. CLIENT ne peut pas valider (403, aucune mutation)", async ({ request }) => {
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    await connecter(request, "client-demo@example.com");
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "valider" } });
    expect(reponse.status()).toBe(403);
    expect((await prisma.learning.findUnique({ where: { id: learning.id } }))?.statut).toBe("PROPOSE");
  });
});

test.describe("DB-04 — Obsolescence", () => {
  test("16. ADMIN peut marquer obsolète un Learning ACTIVE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "marquer_obsolete" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).applicabilite).toBe("OBSOLETE");
  });

  test("17. INGENIEUR ne peut pas marquer obsolète (403, aucune mutation)", async ({ request }) => {
    const mission = await creerMission();
    const learning = await creerLearning(mission.id);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "marquer_obsolete" } });
    expect(reponse.status()).toBe(403);
    expect((await prisma.learning.findUnique({ where: { id: learning.id } }))?.applicabilite).toBe("ACTIVE");
  });
});

test.describe("DB-04 — Immutabilité / provenance", () => {
  test("18. contenu immuable : aucune route n'autorise l'édition de title/statement/type/provenance/confidence/scope/source", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id, { provenance: "DECLARED" });
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, {
      data: { title: "Titre modifié", statement: "Contenu modifié", provenance: "VERIFIED" },
    });
    expect(reponse.status()).toBe(400); // "action invalide" — aucun champ de contenu n'est jamais lu
    const enBase = await prisma.learning.findUnique({ where: { id: learning.id } });
    expect(enBase?.title).toBe(learning.title);
    expect(enBase?.statement).toBe(learning.statement);
    expect(enBase?.provenance).toBe("DECLARED");
  });

  test("19. provenance INFERRED reste INFERRED après validation humaine (jamais promue en VERIFIED)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const learning = await creerLearning(mission.id, { provenance: "INFERRED" });
    const reponse = await request.patch(`/api/missions/${mission.id}/learning/${learning.id}`, { data: { action: "valider" } });
    const corps = await reponse.json();
    expect(corps.statut).toBe("VALIDE");
    expect(corps.provenance).toBe("INFERRED"); // jamais VERIFIED malgré la validation
  });
});

test.describe("DB-04 — Supersession", () => {
  test("20. supersession affichée correctement (supersedesId visible, jamais une mutation de l'ancienne ligne)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission();
    const original = await creerLearning(mission.id);
    const correction = await request.post(`/api/missions/${mission.id}/learning`, {
      data: { type: "LESSON", title: "Correction", statement: "Version corrigée.", provenance: "DECLARED", confidence: "MEDIUM", supersedesId: original.id },
    });
    expect(correction.status(), await correction.text()).toBe(201);
    const corrige = await correction.json();
    expect(corrige.supersedesId).toBe(original.id);

    const lectureOriginal = await request.get(`/api/missions/${mission.id}/learning/${original.id}`);
    const corpsOriginal = await lectureOriginal.json();
    expect(corpsOriginal.statut).toBe("PROPOSE"); // jamais mutée par la supersession
    expect(corpsOriginal.title).toBe(original.title);
  });
});
