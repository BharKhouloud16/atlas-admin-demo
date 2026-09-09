import { test, expect, APIRequestContext } from "@playwright/test";

// COMPANY ATLAS — B20 : Permission Registry (GET /api/security/permissions).
// Couvre la checklist de tests de la directive B20 (section "TESTS
// OBLIGATOIRES") : association AgentIdentity -> Permission, absence de
// permission implicite, séparation humain/agent, impossibilité pour un
// client de choisir une identité agent ou d'injecter une permission,
// protection API (RBAC), absence de mutation, isolation du périmètre,
// déterminisme, absence de secrets.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

const ACTIONS_VALIDES = ["READ", "WRITE", "EXECUTE", "PROPOSE", "REPORT", "ANALYZE"];
const SCOPES_VALIDES = ["TALENT", "SECURITY", "COMPANY_OS", "PRINCIPAL"];

test.describe("COMPANY ATLAS B20 — Permission Registry (API)", () => {
  test("le registre contient exactement les 2 permissions minimales justifiées, aucune implicite pour PRINCIPAL ni COMPANY_OS", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security/permissions");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { permissions } = await reponse.json();
    expect(permissions.length).toBe(2);

    const agents = await (await request.get("/api/security/agents")).json();
    const idParAgent: Record<string, string> = {};
    for (const a of agents.agents) idParAgent[a.agent] = a.id;

    const talent = permissions.find((p: { agentId: string }) => p.agentId === idParAgent["ATLAS_TALENT"]);
    expect(talent).toBeTruthy();
    expect(talent.action).toBe("READ");
    expect(talent.scope).toBe("TALENT");

    const security = permissions.find((p: { agentId: string }) => p.agentId === idParAgent["ATLAS_OS_SERVICES"]);
    expect(security).toBeTruthy();
    expect(security.action).toBe("ANALYZE");
    expect(security.scope).toBe("SECURITY");

    // Aucune permission implicite : ni PRINCIPAL ni COMPANY_OS ne reçoivent
    // de ligne dans le seed initial (directive B20, règles 7 et 8).
    expect(permissions.some((p: { agentId: string }) => p.agentId === idParAgent["PRINCIPAL"])).toBe(false);
    expect(permissions.some((p: { agentId: string }) => p.agentId === idParAgent["COMPANY_OS"])).toBe(false);
  });

  test("chaque permission est associée à un agentId qui existe réellement dans AgentIdentity (jointure vérifiée)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const { agents } = await (await request.get("/api/security/agents")).json();
    const idsConnus = new Set(agents.map((a: { id: string }) => a.id));

    for (const p of permissions) {
      expect(idsConnus.has(p.agentId), `agentId ${p.agentId} doit exister dans AgentIdentity`).toBe(true);
    }
  });

  test("chaque permission utilise uniquement des valeurs du vocabulaire fermé (action/scope/statut)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    for (const p of permissions) {
      expect(ACTIONS_VALIDES).toContain(p.action);
      expect(SCOPES_VALIDES).toContain(p.scope);
      expect(["ACTIVE", "DISABLED"]).toContain(p.statut);
    }
  });

  test("une entrée client arbitraire (paramètres de requête) ne peut ni choisir une identité agent, ni injecter une permission, ni filtrer le registre", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const brut = await (await request.get("/api/security/permissions")).json();
    const manipule = await request.get(
      "/api/security/permissions?agentId=HACKER&action=EXECUTE&scope=PRINCIPAL&statut=ACTIVE"
    );
    expect(manipule.ok()).toBeTruthy();
    const { permissions } = await manipule.json();
    expect(permissions).toEqual(brut.permissions);
    expect(permissions.some((p: { agentId: string }) => p.agentId === "HACKER")).toBe(false);
  });

  test("aucune route de mutation n'existe : POST/PATCH/DELETE sont refusés (404/405), jamais de permission créée ni modifiée", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const avant = await (await request.get("/api/security/permissions")).json();

    const post = await request.post("/api/security/permissions", {
      data: { agentId: "agent-principal", action: "EXECUTE", scope: "PRINCIPAL" },
    });
    expect([404, 405]).toContain(post.status());

    const patch = await request.patch("/api/security/permissions", { data: { statut: "DISABLED" } });
    expect([404, 405]).toContain(patch.status());

    const del = await request.delete("/api/security/permissions");
    expect([404, 405]).toContain(del.status());

    const apres = await (await request.get("/api/security/permissions")).json();
    expect(apres.permissions).toEqual(avant.permissions);
  });

  test("SÉCURITÉ : un CLIENT et un INGENIEUR n'ont jamais accès au Permission Registry (403)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get("/api/security/permissions");
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get("/api/security/permissions");
    expect(refusIngenieur.status()).toBe(403);
  });

  test("SÉCURITÉ : sans session, l'accès est refusé (403)", async ({ request }) => {
    const reponse = await request.get("/api/security/permissions", { headers: { Cookie: "" } });
    expect(reponse.status()).toBe(403);
  });

  test("déterminisme : deux appels consécutifs renvoient exactement le même registre", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const premier = await (await request.get("/api/security/permissions")).json();
    const second = await (await request.get("/api/security/permissions")).json();
    expect(premier.permissions).toEqual(second.permissions);
  });

  test("absence de secrets : aucun champ du registre n'accepte un identifiant de type mot de passe/token", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const champs = Object.keys(permissions[0]);
    expect(champs.some((c) => /password|motdepasse|token|secret|apikey/i.test(c))).toBe(false);
  });
});
