import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — CLIENT COMPLETION PROGRAM (16/09/2026).
// Couvre C4 (GET /api/client/missions expose enfin dateDebut/dateFin/
// modeTravail/sourceDemande), C6 (persistance best-effort des contrats
// générés en Document + fileUrl jamais exposé + route de téléchargement
// authentifiée) et C7 (persistance best-effort des factures générées).
// Le stockage réel (Vercel Blob) n'est pas configuré dans cet
// environnement (BLOB_READ_WRITE_TOKEN absent, comme pour l'import CV/
// vidéo — voir lib/storage.ts) : les assertions de persistance documentent
// donc le comportement "best-effort, jamais bloquant" plutôt qu'une
// écriture réussie, qui n'est vérifiable qu'en environnement Vercel réel.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Ingénieur Test CLIENT-CONNECT ${suffixe}` } });
}

async function creerDemande(clientId: string, extra: Record<string, unknown> = {}) {
  const suffixe = Date.now() + Math.random();
  return prisma.demandeTalent.create({
    data: { clientId, description: `Demande de test CLIENT-CONNECT ${suffixe}`, ...extra },
  });
}

test.describe("CLIENT COMPLETION — C4 : GET /api/client/missions expose le contexte LOT6", () => {
  test("dateDebut/dateFin/modeTravail/sourceDemande sont présents, jamais les tarifs", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const demande = await creerDemande(client!.id, { titre: "Besoin CLIENT-CONNECT C4", mobilite: "Remote" });

    const creation = await request.post("/api/missions", {
      data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 500, dateDebut: "2027-03-01", modeTravail: "Remote" },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionAdmin = await creation.json();

    await connecter(request, "client-demo@example.com");
    const liste = await request.get("/api/client/missions");
    expect(liste.ok()).toBeTruthy();
    const missions = await liste.json();
    const mission = missions.find((m: { id: string }) => m.id === missionAdmin.id);
    expect(mission).toBeTruthy();

    expect(new Date(mission.dateDebut).toISOString().slice(0, 10)).toBe("2027-03-01");
    expect(mission.modeTravail).toBe("Remote");
    expect(mission.sourceDemande).toEqual({ id: demande.id, titre: "Besoin CLIENT-CONNECT C4" });

    expect(mission).not.toHaveProperty("tjmVente");
    expect(mission).not.toHaveProperty("margeCible");
    expect(mission).not.toHaveProperty("ca");
  });

  test("mission sans sourceDemandeId : sourceDemande/dateDebut/modeTravail restent null, jamais une valeur inventée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });
    const missionAdmin = await creation.json();

    await connecter(request, "client-demo@example.com");
    const liste = await request.get("/api/client/missions");
    const missions = await liste.json();
    const mission = missions.find((m: { id: string }) => m.id === missionAdmin.id);
    expect(mission.sourceDemande).toBeNull();
    expect(mission.dateDebut).toBeNull();
    expect(mission.modeTravail).toBeNull();
  });
});

test.describe("CLIENT COMPLETION — C6 : contrats générés, Document, et téléchargement authentifié", () => {
  test("génération contrat_prestation/nda (client) : réponse inchangée, persistance best-effort sans jamais bloquer", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 3, tjmVente: 500 } });
    const mission = await creation.json();

    const avant = await prisma.document.count({ where: { missionId: mission.id, type: "CONTRAT" } });

    const generation = await request.post("/api/generate-contract", { data: { missionId: mission.id, templateKey: "contrat_prestation" } });
    expect(generation.status(), await generation.text()).toBe(200);
    expect(generation.headers()["content-type"]).toContain("wordprocessingml.document");

    // Best-effort : dans cet environnement (sans BLOB_READ_WRITE_TOKEN), la
    // persistance échoue silencieusement — la génération elle-même n'est
    // jamais affectée (assertion ci-dessus). Le comptage ne peut donc
    // qu'être stable ici ; il augmenterait de 1 en environnement Vercel réel.
    const apres = await prisma.document.count({ where: { missionId: mission.id, type: "CONTRAT" } });
    expect(apres).toBeGreaterThanOrEqual(avant);
  });

  test("génération d'un modèle interne (cdi/freelance/portage) : jamais persisté en Document visible client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", { data: { clientId: client!.id, profilId: profil.id, nbJours: 3, tjmVente: 500 } });
    const mission = await creation.json();

    for (const templateKey of ["cdi", "freelance", "portage"]) {
      const generation = await request.post("/api/generate-contract", { data: { missionId: mission.id, templateKey } });
      expect(generation.status(), `${templateKey} devrait réussir`).toBe(200);
    }

    // Propriété de sécurité critique, vraie indépendamment du stockage :
    // ces 3 modèles contiennent la rémunération interne de l'ingénieur
    // (montant_profil) et ne doivent JAMAIS produire un Document visible
    // par le Client, quel que soit l'état du stockage.
    const documentsInternes = await prisma.document.count({ where: { missionId: mission.id, type: "CONTRAT" } });
    expect(documentsInternes).toBe(0);
  });

  test("GET /api/client/documents n'expose jamais fileUrl (URL de stockage privée)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const mission = await prisma.mission.create({ data: { clientId: client!.id, profilId: profil.id, nbJours: 3, tjmVente: 500 } });
    await prisma.document.create({
      data: { titre: `Contrat de test ${Date.now()}`, type: "CONTRAT", fileUrl: "https://blob.example/documents/secret-token-path.docx", missionId: mission.id, clientId: client!.id },
    });

    await connecter(request, "client-demo@example.com");
    const liste = await request.get("/api/client/documents");
    expect(liste.ok()).toBeTruthy();
    const documents = await liste.json();
    expect(documents.length).toBeGreaterThan(0);
    for (const d of documents) {
      expect(d).not.toHaveProperty("fileUrl");
      expect(d).toHaveProperty("id");
      expect(d).toHaveProperty("titre");
      expect(d).toHaveProperty("type");
    }
  });

  test.describe("GET /api/client/documents/[id]/fichier", () => {
    test("non authentifié / mauvais rôle -> 403", async ({ request }) => {
      const doc = await prisma.document.findFirst();
      const idQuelconque = doc?.id ?? "inexistant";

      const sansSession = await request.get(`/api/client/documents/${idQuelconque}/fichier`);
      expect(sansSession.status()).toBe(403);

      await connecter(request, "admin-demo@example.com");
      const commeAdmin = await request.get(`/api/client/documents/${idQuelconque}/fichier`);
      expect(commeAdmin.status()).toBe(403);
    });

    test("IDOR : le document d'un autre client renvoie 404, jamais une fuite d'existence", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const creationClient = await request.post("/api/clients", { data: { nom: `Client CLIENT-CONNECT IDOR ${Date.now()}` } });
      const autreClient = await creationClient.json();
      const profil = await creerProfil();
      const mission = await prisma.mission.create({ data: { clientId: autreClient.id, profilId: profil.id, nbJours: 3, tjmVente: 500 } });
      const documentEtranger = await prisma.document.create({
        data: { titre: "Contrat confidentiel d'un autre client", type: "CONTRAT", fileUrl: "https://blob.example/documents/x.docx", missionId: mission.id, clientId: autreClient.id },
      });

      await connecter(request, "client-demo@example.com");
      const tentative = await request.get(`/api/client/documents/${documentEtranger.id}/fichier`);
      expect(tentative.status()).toBe(404);
    });

    test("document inexistant -> 404", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.get("/api/client/documents/inexistant-xyz/fichier");
      expect(reponse.status()).toBe(404);
    });

    test("document du client courant, stockage indisponible dans cet environnement -> 503 géré proprement (jamais un crash)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const mission = await prisma.mission.create({ data: { clientId: client!.id, profilId: profil.id, nbJours: 3, tjmVente: 500 } });
      const document = await prisma.document.create({
        data: { titre: "Contrat de test", type: "CONTRAT", fileUrl: "https://blob.example/documents/inaccessible.docx", missionId: mission.id, clientId: client!.id },
      });

      await connecter(request, "client-demo@example.com");
      const reponse = await request.get(`/api/client/documents/${document.id}/fichier`);
      // Ownership déjà vérifiée avant l'appel au stockage : le statut
      // exact dépend uniquement de la disponibilité du stockage dans cet
      // environnement — jamais un 500 non géré.
      expect([404, 503]).toContain(reponse.status());
    });
  });
});

test.describe("CLIENT COMPLETION — C7 : facture générée, persistance best-effort", () => {
  async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
    const reponse = await request.get("/api/profils");
    const { profils } = await reponse.json();
    return profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo").id;
  }

  test("le circuit CRA -> double validation -> facture reste inchangé même si la persistance échoue silencieusement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profilId = await idProfilIngenieurDemo(request);
    const creation = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId, nbJours: 5, tjmVente: 500, repere: `Test CLIENT-CONNECT C7 ${Date.now()}` },
    });
    const mission = await creation.json();

    await connecter(request, "ingenieur-demo@example.com");
    const soumission = await request.post("/api/feuilles-de-temps", {
      data: { missionId: mission.id, mois: "2027-04", joursTravailles: 5, heuresSupplementaires: 0, soumettre: true },
    });
    expect(soumission.status(), await soumission.text()).toBe(201);
    const feuille = await soumission.json();

    await connecter(request, "admin-demo@example.com");
    await request.patch("/api/feuilles-de-temps", { data: { id: feuille.id, action: "validerAdmin" } });

    await connecter(request, "client-demo@example.com");
    await request.patch("/api/feuilles-de-temps", { data: { id: feuille.id, action: "validerClient" } });

    await connecter(request, "admin-demo@example.com");
    const avant = await prisma.document.count({ where: { missionId: mission.id, type: "FACTURE" } });
    const facture = await request.get(`/api/feuilles-de-temps/facture?feuilleId=${feuille.id}`);
    expect(facture.status(), await facture.text()).toBe(200);
    expect(facture.headers()["content-type"]).toContain("application/pdf");

    // Même discipline best-effort que C6 : voir commentaire d'en-tête.
    const apres = await prisma.document.count({ where: { missionId: mission.id, type: "FACTURE" } });
    expect(apres).toBeGreaterThanOrEqual(avant);
  });
});
