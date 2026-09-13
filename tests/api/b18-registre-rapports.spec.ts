import { test, expect, APIRequestContext } from "@playwright/test";

// COMPANY ATLAS — B18-FIX : registre structuré de rapports inter-agents
// (RapportAgent, app/api/security/rapports), reconstruit sur AgentIdentity
// (B19) comme source unique de vérité — chaque rapport référence un
// agentId -> AgentIdentity.id au lieu d'un enum AgentEmetteur libre.
// Couvre la checklist de l'audit B18-FIX : création, traçabilité,
// UNKNOWN, plafonnement, RBAC, validation d'un agentId réel et actif,
// rejet d'un agentId invalide/inexistant, jointure AgentIdentity,
// non-régression runtime B16/B17 et non-régression B19/B20, absence de
// secrets.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idAgent(request: APIRequestContext, nom: string): Promise<string> {
  const reponse = await request.get("/api/security/agents");
  const { agents } = await reponse.json();
  const agent = agents.find((a: { agent: string }) => a.agent === nom);
  if (!agent) throw new Error(`Agent ${nom} introuvable dans AgentIdentity`);
  return agent.id;
}

test.describe("COMPANY ATLAS B18-FIX — registre de rapports agents (API)", () => {
  test("un Admin peut créer un rapport référencé par agentId ; il est relisible par correlationId", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = `b18fix-creation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const creation = await request.post("/api/security/rapports", {
      data: {
        correlationId,
        agentId,
        typeRapport: "audit",
        objectif: "Test B18-FIX : création d'un rapport",
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
    expect(rapports[0].objectif).toBe("Test B18-FIX : création d'un rapport");
    expect(rapports[0].agentId).toBe(agentId);
  });

  test("chaque rapport créé est associé à un agentId qui existe réellement dans AgentIdentity (jointure vérifiée)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const correlationId = `b18fix-jointure-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await request.post("/api/security/rapports", {
      data: { correlationId, agentId, typeRapport: "audit", objectif: "Test jointure", statut: "COMPLETE" },
    });

    const { agents } = await (await request.get("/api/security/agents")).json();
    const idsConnus = new Set(agents.map((a: { id: string }) => a.id));
    const { rapports } = await (await request.get(`/api/security/rapports?correlationId=${correlationId}`)).json();
    expect(rapports.length).toBe(1);
    expect(idsConnus.has(rapports[0].agentId)).toBe(true);
  });

  test("plusieurs rapports liés par le même correlationId sont tous retrouvés (traçabilité transverse, Charte E.3)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b18fix-chaine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idTalent = await idAgent(request, "ATLAS_TALENT");
    const idSecurity = await idAgent(request, "ATLAS_OS_SERVICES");

    for (const agentId of [idTalent, idSecurity]) {
      const reponse = await request.post("/api/security/rapports", {
        data: { correlationId, agentId, typeRapport: "palier2", objectif: `Étape ${agentId}`, statut: "COMPLETE" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
    }

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    expect(rapports.length).toBe(2);
    const idsRecus = rapports.map((r: { agentId: string }) => r.agentId).sort();
    expect(idsRecus).toEqual([idTalent, idSecurity].sort());
  });

  test("un champ UNKNOWN explicite (inconnu) est conservé tel quel ; absent, il reste null (Charte E.5)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const correlationId = `b18fix-unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await request.post("/api/security/rapports", {
      data: {
        correlationId,
        agentId,
        typeRapport: "audit",
        objectif: "Avec UNKNOWN",
        statut: "PARTIEL",
        inconnu: "Mécanisme technique de vérification des permissions à l'exécution — UNKNOWN (Charte F.1).",
      },
    });
    await request.post("/api/security/rapports", {
      data: { correlationId, agentId, typeRapport: "audit", objectif: "Sans UNKNOWN", statut: "COMPLETE" },
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
    const agentId = await idAgent(request, "COMPANY_OS");
    const correlationId = `b18fix-plafond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const texteLong = "a".repeat(10000);

    await request.post("/api/security/rapports", {
      data: { correlationId, agentId, typeRapport: "autre", objectif: "Test plafond", analyse: texteLong, statut: "COMPLETE" },
    });

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    expect(rapports[0].analyse.length).toBeLessThan(texteLong.length);
  });

  test("validation : un agentId inexistant est rejeté (400), jamais un rapport orphelin créé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/security/rapports", {
      data: { agentId: "agent-invente-qui-nexiste-pas", typeRapport: "audit", objectif: "x", statut: "COMPLETE" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("validation : agentId manquant est rejeté (400), jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/security/rapports", {
      data: { typeRapport: "audit", objectif: "x", statut: "COMPLETE" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("validation : objectif manquant est rejeté (400), jamais un crash serveur", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const reponse = await request.post("/api/security/rapports", {
      data: { agentId, typeRapport: "audit", statut: "COMPLETE" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("SÉCURITÉ : un CLIENT et un INGENIEUR n'ont jamais accès au registre de rapports (403)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refusGet = await request.get("/api/security/rapports");
    expect(refusGet.status()).toBe(403);
    const refusPost = await request.post("/api/security/rapports", {
      data: { agentId: "agent-principal", typeRapport: "audit", objectif: "x", statut: "COMPLETE" },
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
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const marqueurUnique = `MARQUEUR-B18FIX-NONREG-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const creation = await request.post("/api/security/rapports", {
      data: { agentId, typeRapport: "audit", objectif: marqueurUnique, statut: "COMPLETE" },
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

  test("NON-RÉGRESSION B19/B20 : /api/security/agents et /api/security/permissions restent inchangés et fonctionnels", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agents = await request.get("/api/security/agents");
    expect(agents.ok()).toBeTruthy();
    const { agents: liste } = await agents.json();
    expect(liste.length).toBe(4);

    const permissions = await request.get("/api/security/permissions");
    expect(permissions.ok()).toBeTruthy();
    const { permissions: listePermissions } = await permissions.json();
    expect(listePermissions.length).toBe(2);
  });

  test("absence de secrets : aucun champ du modèle n'accepte un identifiant de type mot de passe/token", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const correlationId = `b18fix-nosecret-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const creation = await request.post("/api/security/rapports", {
      data: { correlationId, agentId, typeRapport: "audit", objectif: "Test absence de secrets", statut: "COMPLETE" },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    const lecture = await request.get(`/api/security/rapports?correlationId=${correlationId}`);
    const { rapports } = await lecture.json();
    const champs = Object.keys(rapports[0]);
    expect(champs.some((c) => /password|motdepasse|token|secret|apikey/i.test(c))).toBe(false);
  });
});
