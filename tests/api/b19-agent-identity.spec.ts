import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// COMPANY ATLAS — B19 : registre Agent Identity (GET /api/security/agents).
// Couvre la checklist de tests de la directive B19 (Phase 11) : les 4
// identités officielles existent, aucun 5e agent n'est accepté, chaque
// identité a un identifiant stable, distinction avec les Users humains,
// DISABLED jamais actif (couvert côté fonctions pures, voir
// tests/unit/agent-identity.spec.ts), aucune usurpation possible via une
// entrée client arbitraire, RBAC (réservé ADMIN), absence de secret.

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

const AGENTS_ATTENDUS = ["PRINCIPAL", "ATLAS_TALENT", "ATLAS_OS_SERVICES", "COMPANY_OS"].sort();

test.describe("COMPANY ATLAS B19 — Agent Identity (API)", () => {
  test("les 4 identités officielles existent, jamais un 5e agent (registre seedé par migration)", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/security/agents");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { agents } = await reponse.json();
    expect(agents.length).toBe(4);
    const noms = agents.map((a: { agent: string }) => a.agent).sort();
    expect(noms).toEqual(AGENTS_ATTENDUS);
  });

  test("chaque identité possède un identifiant stable, identique d'un appel à l'autre", async () => {
    let request = await connecter("ADMIN");
    const premier = await (await request.get("/api/security/agents")).json();
    const second = await (await request.get("/api/security/agents")).json();
    const idsA = premier.agents.map((a: { id: string; agent: string }) => `${a.agent}:${a.id}`).sort();
    const idsB = second.agents.map((a: { id: string; agent: string }) => `${a.agent}:${a.id}`).sort();
    expect(idsA).toEqual(idsB);
    for (const a of premier.agents) {
      expect(typeof a.id).toBe("string");
      expect(a.id.length).toBeGreaterThan(0);
    }
  });

  test("les identités agent sont structurellement distinctes d'un compte User humain (aucun champ d'authentification humaine)", async ({
    request,
  }) => {
    request = await connecter("ADMIN");
    const { agents } = await (await request.get("/api/security/agents")).json();
    const champs = Object.keys(agents[0]);
    expect(champs.some((c) => /email|passwordHash|role\b|clientId|profilId/i.test(c))).toBe(false);
    expect(champs).toEqual(
      expect.arrayContaining(["id", "agent", "nomTechnique", "statut", "description", "version", "createdAt", "updatedAt"])
    );
  });

  test("toutes les identités seedées sont ACTIVE par défaut (aucune DISABLED sans décision explicite)", async () => {
    let request = await connecter("ADMIN");
    const { agents } = await (await request.get("/api/security/agents")).json();
    expect(agents.every((a: { statut: string }) => a.statut === "ACTIVE")).toBe(true);
  });

  test("une entrée client arbitraire (paramètre de requête) ne peut jamais usurper ou injecter une 5e identité", async ({
    request,
  }) => {
    request = await connecter("ADMIN");
    const reponse = await request.get("/api/security/agents?agent=HACKER_AGENT&nomTechnique=usurpe");
    expect(reponse.ok()).toBeTruthy();
    const { agents } = await reponse.json();
    expect(agents.length).toBe(4);
    expect(agents.some((a: { agent: string }) => a.agent === "HACKER_AGENT")).toBe(false);
  });

  test("aucune route de création n'existe : POST /api/security/agents est refusé (405/404), jamais un 5e agent créé", async ({
    request,
  }) => {
    request = await connecter("ADMIN");
    const reponse = await request.post("/api/security/agents", {
      data: { agent: "NOUVEL_AGENT", nomTechnique: "intrus" },
    });
    expect([404, 405]).toContain(reponse.status());

    const lecture = await request.get("/api/security/agents");
    const { agents } = await lecture.json();
    expect(agents.length).toBe(4);
  });

  test("SÉCURITÉ : un CLIENT et un INGENIEUR n'ont jamais accès au registre Agent Identity (403)", async () => {
    let request = await connecter("CLIENT");
    const refusClient = await request.get("/api/security/agents");
    expect(refusClient.status()).toBe(403);

    request = await connecter("INGENIEUR");
    const refusIngenieur = await request.get("/api/security/agents");
    expect(refusIngenieur.status()).toBe(403);
  });

  test("SÉCURITÉ : sans session, l'accès est refusé (403)", async ({ request }) => {
    // Nouveau contexte sans cookie de session : APIRequestContext partagé
    // par défaut par Playwright conserve les cookies entre tests du même
    // fichier — on vérifie ici via un en-tête Cookie vide explicite plutôt
    // que de dépendre de l'ordre d'exécution des tests précédents.
    const reponse = await request.get("/api/security/agents", { headers: { Cookie: "" } });
    expect(reponse.status()).toBe(403);
  });

  test("absence de secrets : aucun champ du registre n'accepte un identifiant de type mot de passe/token", async () => {
    let request = await connecter("ADMIN");
    const { agents } = await (await request.get("/api/security/agents")).json();
    const champs = Object.keys(agents[0]);
    expect(champs.some((c) => /password|motdepasse|token|secret|apikey/i.test(c))).toBe(false);
  });
});
