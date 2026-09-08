import { test, expect, APIRequestContext } from "@playwright/test";

// COMPANY ATLAS — B18 : registre structuré de rapports inter-agents
// (RapportAgent, app/api/security/rapports). Couvre la checklist de la
// directive B18 (étape 4) : création, correlationId/traçabilité, UNKNOWN,
// plafonnement des textes, RBAC (réservé ADMIN), validation des 4 agents
// officiels, et — point central de l'audit B18 (étape 1) — la preuve de
// non-régression : un rapport de gouvernance n'apparaît JAMAIS dans les
// surfaces de lecture d'EvenementSecurite (/api/security/runtime,
// /api/security/evenements), confirmant que la table séparée choisie en
// conception (lib/gouvernance/rapports.ts) ne pollue pas les signaux
// runtime déjà validés sur ATLAS TALENT (B16/B17).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("COMPANY ATLAS B18 — registre de rapports agents (API)", () => {
  test("un Admin peut créer un rapport ; il est relisible par correlationId", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18-creation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const creation = await request.post("/api/security/rapports", {
      data: {
        correlationId,
        agentEmetteur: "ATLAS_TALENT",
        typeRapport: "audit",
        objectif: "Test B18 : création d'un rapport",
        analyse: "Analyse de test",
        statut: "COMPLETE",
      },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const corps = await creation.json();
    expect(corps.correlationId).toBe(correlationId);

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    expect(lecture.ok()).toBeTruthy();
    const { rapports } = await lecture.json();
    expect(rapports.length).toBe(1);
    expect(rapports[0].objectif).toBe("Test B18 : création d'un rapport");
    expect(rapports[0].agentEmetteur).toBe("ATLAS_TALENT");
  });

  test("plusieurs rapports liés par le même correlationId sont tous retrouvés (traçabilité transverse, Charte E.3)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18-chaine-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (const agentEmetteur of ["ATLAS_TALENT", "ATLAS_OS_SERVICES"] as const) {
      const reponse = await request.post("/api/security/rapports", {
        data: { correlationId, agentEmetteur, typeRapport: "palier2", objectif: `Étape ${agentEmetteur}`, statut: "COMPLETE" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
    }

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    expect(rapports.length).toBe(2);
    const agents = rapports.map((r: { agentEmetteur: string }) => r.agentEmetteur).sort();
    expect(agents).toEqual(["ATLAS_OS_SERVICES", "ATLAS_TALENT"]);
  });

  test("un champ UNKNOWN explicite (inconnu) est conservé tel quel ; absent, il reste null (Charte E.5)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18-unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await request.post("/api/security/rapports", {
      data: {
        correlationId,
        agentEmetteur: "PRINCIPAL",
        typeRapport: "audit",
        objectif: "Avec UNKNOWN",
        statut: "PARTIEL",
        inconnu: "Mécanisme technique de vérification des permissions à l'exécution — UNKNOWN (Charte F.1).",
      },
    });
    await request.post("/api/security/rapports", {
      data: { correlationId, agentEmetteur: "PRINCIPAL", typeRapport: "audit", objectif: "Sans UNKNOWN", statut: "COMPLETE" },
    });

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    const avecUnknown = rapports.find((r: { objectif: string }) => r.objectif === "Avec UNKNOWN");
    const sansUnknown = rapports.find((r: { objectif: string }) => r.objectif === "Sans UNKNOWN");
    expect(avecUnknown.inconnu).toContain("UNKNOWN");
    expect(sansUnknown.inconnu).toBeNull();
  });

  test("un texte trop long est plafonné plutôt que stocké intégralement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18-plafond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const texteLong = "a".repeat(10000);

    await request.post("/api/security/rapports", {
      data: { correlationId, agentEmetteur: "COMPANY_OS", typeRapport: "autre", objectif: "Test plafond", analyse: texteLong, statut: "COMPLETE" },
    });

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    expect(rapports[0].analyse.length).toBeLessThan(texteLong.length);
  });

  test("validation : un agentEmetteur hors des 4 agents officiels est rejeté (400), jamais un 5e agent silencieux", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/security/rapports", {
      data: { agentEmetteur: "ATLAS_AUTRE_INVENTE", typeRapport: "audit", objectif: "x", statut: "COMPLETE" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("validation : objectif manquant est rejeté (400), jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/security/rapports", {
      data: { agentEmetteur: "PRINCIPAL", typeRapport: "audit", statut: "COMPLETE" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("SÉCURITÉ : un CLIENT et un INGENIEUR n'ont jamais accès au registre de rapports (403)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refusGet = await request.get("/api/security/rapports");
    expect(refusGet.status()).toBe(403);
    const refusPost = await request.post("/api/security/rapports", {
      data: { agentEmetteur: "PRINCIPAL", typeRapport: "audit", objectif: "x", statut: "COMPLETE" },
    });
    expect(refusPost.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusGet2 = await request.get("/api/security/rapports");
    expect(refusGet2.status()).toBe(403);
  });

  test("NON-RÉGRESSION : un rapport de gouvernance n'apparaît jamais dans /api/security/runtime ni /api/security/evenements (table séparée d'EvenementSecurite)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const marqueurUnique = `MARQUEUR-B18-NONREG-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const creation = await request.post("/api/security/rapports", {
      data: { agentEmetteur: "ATLAS_OS_SERVICES", typeRapport: "audit", objectif: marqueurUnique, statut: "COMPLETE" },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    const runtime = await request.get("/api/security/runtime");
    expect(runtime.ok()).toBeTruthy();
    const texteRuntime = JSON.stringify(await runtime.json());
    expect(texteRuntime).not.toContain(marqueurUnique);

    const evenements = await request.get("/api/security/evenements?limite=200");
    expect(evenements.ok()).toBeTruthy();
    const texteEvenements = JSON.stringify(await evenements.json());
    expect(texteEvenements).not.toContain(marqueurUnique);
  });

  test("absence de secrets : aucun champ du modèle n'accepte un identifiant de type mot de passe/token (responsabilité de l'appelant, comme EvenementSecurite)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18-nosecret-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Le module ne peut pas deviner qu'une valeur est un secret (même
    // discipline que lib/security/events.ts) — ce test vérifie seulement
    // que le modèle n'expose aucun champ dédié à un secret et que la
    // réponse ne renvoie jamais un champ nommé password/token/secret.
    const creation = await request.post("/api/security/rapports", {
      data: { correlationId, agentEmetteur: "PRINCIPAL", typeRapport: "audit", objectif: "Test absence de secrets", statut: "COMPLETE" },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    const champs = Object.keys(rapports[0]);
    expect(champs.some((c) => /password|motdepasse|token|secret|apikey/i.test(c))).toBe(false);
  });
});
