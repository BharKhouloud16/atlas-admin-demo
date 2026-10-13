import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// ATLAS TRUST / ATLAS TALENT — Talent Trust V2 (Batch 8) — chemin API :
// RBAC, isolation, absence de crash, déterminisme, explicabilité. LEÇON DES
// BATCHES 4/5/6/7 : ce fichier reste strictement lecture seule — aucune
// écriture sur le profil "Ingénieur Démo" partagé.

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

test.describe("ATLAS TRUST — Talent Trust V2 — API", () => {
  test("27. candidat sans données : réponse 200, aucun crash, DONNEES_INSUFFISANTES plutôt qu'un niveau inventé", async () => {
    let request = await connecter("ADMIN");
    const liste = await request.get("/api/profils");
    const { profils } = await liste.json();
    const profilVide = profils.find((p: { nom: string }) => p.nom === "Nouvel Ingénieur (test)");
    expect(profilVide).toBeTruthy();

    const reponse = await request.get(`/api/profils/${profilVide.id}/talent-trust`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { talentTrust } = await reponse.json();
    expect(["DONNEES_INSUFFISANTES", "BASSE"]).toContain(talentTrust.niveauGlobal);
    for (const composant of Object.values(talentTrust.composants) as { evidence: string }[]) {
      expect(composant.evidence.length).toBeGreaterThan(0);
    }
  });

  test("28. chaque composant du Trust est explicable individuellement (label + niveau + evidence), jamais un score brut isolé", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const reponse = await request.get(`/api/profils/${profilId}/talent-trust`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { talentTrust } = await reponse.json();
    const composants = Object.values(talentTrust.composants) as { label: string; niveau: string; evidence: string }[];
    expect(composants.length).toBe(7);
    for (const c of composants) {
      expect(typeof c.label).toBe("string");
      expect(["HAUTE", "MOYENNE", "BASSE", "INCONNUE"]).toContain(c.niveau);
      expect(c.evidence.length).toBeGreaterThan(0);
    }
    expect(typeof talentTrust.explicationGlobale).toBe("string");
    expect(talentTrust.explicationGlobale.length).toBeGreaterThan(0);
  });

  test("29. isolation RBAC : Talent Trust n'est accessible qu'à l'Admin", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);

    request = await connecter("CLIENT");
    const refusClient = await request.get(`/api/profils/${profilId}/talent-trust`);
    expect(refusClient.status()).toBe(403);

    request = await connecter("INGENIEUR");
    const refusIngenieur = await request.get(`/api/profils/${profilId}/talent-trust`);
    expect(refusIngenieur.status()).toBe(403);
  });

  test("30. profil inexistant : 404, jamais un crash serveur", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/profils/inexistant-xyz/talent-trust");
    expect(reponse.status()).toBe(404);
  });

  test("31. déterminisme : deux appels consécutifs renvoient le même résultat", async () => {
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);
    const r1 = await request.get(`/api/profils/${profilId}/talent-trust`);
    const r2 = await request.get(`/api/profils/${profilId}/talent-trust`);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.talentTrust).toEqual(j2.talentTrust);
  });
});
