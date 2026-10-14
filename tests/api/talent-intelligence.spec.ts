import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// ATLAS TALENT — Talent Intelligence V1 (Batch 5) — chemin API : RBAC,
// isolation, absence de crash, cohérence avec Candidate Intelligence.
// LEÇON DU BATCH 4 (voir tests/api/candidate-intelligence.spec.ts) :
// AUCUNE écriture ici sur le profil "Ingénieur Démo" partagé — Playwright
// tourne en fullyParallel (voir playwright.config.ts) et plusieurs fichiers
// écrivant concurremment sur le même profil via /api/ingenieur/disponibilite
// (remplacement complet) provoquent des échecs intermittents ailleurs. Ce
// fichier reste strictement lecture seule.

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

async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/profils");
  expect(reponse.ok()).toBeTruthy();
  const { profils } = await reponse.json();
  const profil = profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo");
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil.id;
}

test.describe("ATLAS TALENT — Talent Intelligence V1 — API", () => {
  test("11. candidat sans données : réponse 200, aucun crash, structure cohérente", async () => {
    let request = await connecter("ADMIN");
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const profilVide = profils.find((p: { nom: string }) => p.nom === "Nouvel Ingénieur (test)");
    expect(profilVide).toBeTruthy();

    const reponse = await request.get(`/api/profils/${profilVide.id}/talent-intelligence`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { talentIntelligence } = await reponse.json();
    expect(talentIntelligence.forces).toEqual([]);
    expect(talentIntelligence.performance.statut).toBe("INCONNU");
  });

  test("12. cohérence avec Candidate Intelligence : mêmes zones inconnues, aucune divergence", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);

    const candidateReponse = await request.get(`/api/profils/${profilId}/intelligence`);
    const { intelligence } = await candidateReponse.json();

    const talentReponse = await request.get(`/api/profils/${profilId}/talent-intelligence`);
    expect(talentReponse.ok(), await talentReponse.text()).toBeTruthy();
    const { talentIntelligence } = await talentReponse.json();

    expect(talentIntelligence.inconnues).toEqual(intelligence.zonesInconnues);
  });

  test("13. isolation RBAC : Talent Intelligence n'est accessible qu'à l'Admin", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);

    request = await connecter("CLIENT");
    const refusClient = await request.get(`/api/profils/${profilId}/talent-intelligence`);
    expect(refusClient.status()).toBe(403);

    request = await connecter("INGENIEUR");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/talent-intelligence`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("14. profil inexistant : 404, jamais un crash serveur", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/profils/inexistant-xyz/talent-intelligence");
    expect(reponse.status()).toBe(404);
  });

  test("15. déterminisme : deux appels consécutifs renvoient le même résultat", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/talent-intelligence`);
    const r2 = await request.get(`/api/profils/${profilId}/talent-intelligence`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.talentIntelligence).toEqual(j2.talentIntelligence);
  });
});
