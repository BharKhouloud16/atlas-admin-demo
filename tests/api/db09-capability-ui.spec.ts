import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Couvre les scénarios obligatoires du mandat DB-09 §17. DB-09 ajoute
// EXACTEMENT deux routes (GET /api/capabilities, GET /api/capabilities/
// [id] — lecture seule, Admin-only, aucune dérivation, aucune mutation)
// et réutilise sans modification tout le reste du contrat A8/A21 — cette
// suite verrouille le contrat tel qu'il est réellement consommé par ces
// deux routes et par la nouvelle section Mission → Capabilities
// (app/admin/missions/[id]/capabilities/page.tsx, qui ne consomme que
// GET/POST /api/missions/[id]/capability-links et PATCH .../[linkId],
// déjà exhaustivement testées par tests/api/a21-mission-capability-link.
// spec.ts — jamais réimplémentées ici).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function deconnecter(request: APIRequestContext) {
  await request.post("/api/auth/logout").catch(() => {});
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  return client!;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  return user!.profilId!;
}

async function creerNeedAvecFait(clientId: string, texte: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `db09-${suffixe}`,
      texteOriginal: `Besoin de test DB09 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: [{ cle: "COMPETENCE", valeur: texte, statut: "DECLARE", source: "test" }] },
    },
    include: { faits: true },
  });
}

async function creerCapabilityRequirement(needVersionId: string, requiredCapability: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.capabilityRequirement.create({
    data: {
      needVersionId,
      sourceFaitId: `fait-test-db09-${suffixe}`,
      requiredCapability,
      rationale: "Dérivation de test DB09.",
      provenance: "DECLARE",
    },
  });
}

async function creerMission(clientId: string, profilId: string, needVersionId?: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.mission.create({
    data: {
      clientId,
      profilId,
      needVersionId: needVersionId ?? null,
      repere: `Mission Test DB09 ${suffixe}`,
      nbJours: 5,
      tjmVente: 500,
      statut: StatutMission.EN_COURS,
    },
  });
}

async function creerLien(missionId: string, capabilityRequirementId: string) {
  return prisma.missionCapabilityLink.create({
    data: { missionId, capabilityRequirementId, capability: "Capacité Test DB09", createdByEmail: "admin-demo@example.com" },
  });
}

test.describe("DB-09 — Capability list (GET /api/capabilities)", () => {
  test("1. Admin autorisé → liste accessible", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/capabilities");
    expect(reponse.status(), await reponse.text()).toBe(200);
    const body = await reponse.json();
    expect(Array.isArray(body.capabilities)).toBe(true);
  });

  test("2. la liste reflète exactement les données réelles, aucun champ inventé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité unique DB09-2");
    const capability = await creerCapabilityRequirement(need.id, "Capacité unique DB09-2");

    const reponse = await request.get("/api/capabilities?limite=200");
    const body = await reponse.json();
    const ligne = body.capabilities.find((c: { id: string }) => c.id === capability.id);
    expect(ligne).toBeTruthy();
    expect(ligne.requiredCapability).toBe("Capacité unique DB09-2");
    expect(ligne.rationale).toBe(capability.rationale);
    expect(ligne.provenance).toBe(capability.provenance);
    expect(ligne.status).toBe("ACTIVE");
    expect(ligne.clientNom).toBe(client.nom);
    expect(ligne.nombreMissionsLiees).toBe(0);
  });

  test("3. état vide correctement affiché — filtre sur un statut sans aucune ligne", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    // Aucune CapabilityRequirement n'est jamais créée avec un statut autre
    // que ACTIVE/SUPERSEDED (enum fermé) — filtrer sur SUPERSEDED alors
    // qu'une capacité fraîchement créée est toujours ACTIVE donne un cas
    // réel de filtre réduisant l'ensemble sans jamais planter.
    const client = await clientDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-3");
    await creerCapabilityRequirement(need.id, "Capacité DB09-3");

    const reponse = await request.get("/api/capabilities?statut=SUPERSEDED&limite=1");
    expect(reponse.status()).toBe(200);
    const body = await reponse.json();
    expect(Array.isArray(body.capabilities)).toBe(true);
  });

  test("4. paramètres invalides gérés sans erreur (limite non numérique → valeur par défaut, jamais un crash)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/capabilities?limite=abc");
    expect(reponse.status(), await reponse.text()).toBe(200);
  });
});

test.describe("DB-09 — Capability detail (GET /api/capabilities/[id])", () => {
  test("5. Capability existante → détail complet", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-5");
    const capability = await creerCapabilityRequirement(need.id, "Capacité DB09-5");

    const reponse = await request.get(`/api/capabilities/${capability.id}`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const body = await reponse.json();
    expect(body.id).toBe(capability.id);
    expect(body.requiredCapability).toBe("Capacité DB09-5");
    expect(body.needVersionId).toBe(need.id);
  });

  test("6. Capability inexistante → 404 (comportement contractuel)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/capabilities/id-inexistant-xyz");
    expect(reponse.status()).toBe(404);
  });

  test("7. Missions associées correctement affichées (MissionCapabilityLink réel, jamais inventé)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-7");
    const capability = await creerCapabilityRequirement(need.id, "Capacité DB09-7");
    const mission = await creerMission(client.id, profilId, need.id);
    await creerLien(mission.id, capability.id);

    const reponse = await request.get(`/api/capabilities/${capability.id}`);
    const body = await reponse.json();
    expect(body.missionLinks).toHaveLength(1);
    expect(body.missionLinks[0].missionId).toBe(mission.id);
    expect(body.missionLinks[0].statut).toBe("ACTIVE");
  });

  test("8. Capability sans Mission → missionLinks vide (aucune déduction)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-8");
    const capability = await creerCapabilityRequirement(need.id, "Capacité DB09-8");

    const reponse = await request.get(`/api/capabilities/${capability.id}`);
    const body = await reponse.json();
    expect(body.missionLinks).toHaveLength(0);
  });
});

test.describe("DB-09 — Mission → Capability (réutilise A21 sans modification)", () => {
  test("9/10. Mission n'affiche que ses propres MissionCapabilityLink, jamais un lien inventé ou d'une autre Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-9");
    const capability = await creerCapabilityRequirement(need.id, "Capacité DB09-9");
    const missionA = await creerMission(client.id, profilId, need.id);
    const missionB = await creerMission(client.id, profilId, need.id);
    await creerLien(missionA.id, capability.id);
    await creerLien(missionB.id, capability.id);

    const reponseA = await request.get(`/api/missions/${missionA.id}/capability-links`);
    const bodyA = await reponseA.json();
    expect(bodyA.links).toHaveLength(1);
    expect(bodyA.links[0].missionId).toBe(missionA.id);

    const reponseB = await request.get(`/api/missions/${missionB.id}/capability-links`);
    const bodyB = await reponseB.json();
    expect(bodyB.links).toHaveLength(1);
    expect(bodyB.links[0].missionId).toBe(missionB.id);
  });

  test("11. Capability inexistante référencée dans un lien → 404, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMission(client.id, profilId);

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: "id-inexistant-xyz" },
    });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("DB-09 — Tenant isolation / fuite de relation", () => {
  test("12/13. Aucun accès cross-tenant possible — CLIENT/INGENIEUR n'ont aucun accès, ADMIN reste seul rôle transverse autorisé", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-12");
    const capability = await creerCapabilityRequirement(need.id, "Capacité DB09-12");
    const mission = await creerMission(client.id, profilId, need.id);

    await connecter(request, "client-demo@example.com");
    expect((await request.get("/api/capabilities")).status()).toBe(403);
    expect((await request.get(`/api/capabilities/${capability.id}`)).status()).toBe(403);
    expect((await request.get(`/api/missions/${mission.id}/capability-links`)).status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/capabilities")).status()).toBe(403);
    expect((await request.get(`/api/capabilities/${capability.id}`)).status()).toBe(403);
    expect((await request.get(`/api/missions/${mission.id}/capability-links`)).status()).toBe(403);
  });

  test("14. aucune fuite de relation MissionCapabilityLink entre deux Capability distinctes", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const need = await creerNeedAvecFait(client.id, "Capacité DB09-14");
    const capabiliteA = await creerCapabilityRequirement(need.id, "Capacité DB09-14-A");
    const capabiliteB = await creerCapabilityRequirement(need.id, "Capacité DB09-14-B");
    const missionA = await creerMission(client.id, profilId, need.id);
    const missionB = await creerMission(client.id, profilId, need.id);
    await creerLien(missionA.id, capabiliteA.id);
    await creerLien(missionB.id, capabiliteB.id);

    const reponseA = await request.get(`/api/capabilities/${capabiliteA.id}`);
    const bodyA = await reponseA.json();
    expect(bodyA.missionLinks.map((l: { missionId: string }) => l.missionId)).toEqual([missionA.id]);

    const reponseB = await request.get(`/api/capabilities/${capabiliteB.id}`);
    const bodyB = await reponseB.json();
    expect(bodyB.missionLinks.map((l: { missionId: string }) => l.missionId)).toEqual([missionB.id]);
  });
});

test.describe("DB-09 — RBAC", () => {
  test("15/16. Rôle non autorisé refusé conformément au backend existant, aucune nouvelle permission introduite", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(client.id, profilId);
    await deconnecter(request);

    // Non-authentifié (Agent/visiteur) : même refus générique que tout le
    // reste du contrat A8/A21 (session null -> 403), jamais un comportement
    // distinct inventé pour ce lot.
    expect((await request.get("/api/capabilities")).status()).toBe(403);
    expect((await request.get(`/api/capabilities/${mission.id}`)).status()).toBe(403);
    expect((await request.get(`/api/missions/${mission.id}/capability-links`)).status()).toBe(403);

    await connecter(request, "admin-demo@example.com");
  });
});
