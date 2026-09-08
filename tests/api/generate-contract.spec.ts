import { test, expect, APIRequestContext } from "@playwright/test";

// B15 — aucun test ne couvrait /api/generate-contract avant ce fichier :
// c'est ce qui a laissé passer un bug de déploiement réel (les 5 modèles
// .docx de /templates, bien commités, étaient silencieusement exclus du
// bundle serverless Vercel car app/api/generate-contract/route.ts y accède
// via un objet (TEMPLATES[templateKey]), un accès que le traçage de
// fichiers de Next.js ne résout pas statiquement — voir le correctif dans
// next.config.js, experimental.outputFileTracingIncludes). Ce test ne peut
// pas reproduire le bug lui-même (CI et `next start` local ont le dépôt
// complet, donc les fichiers sont toujours présents sur disque), mais il
// verrouille le comportement correct de la route pour éviter toute
// régression future, et confirme que next.config.js reste valide.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/profils");
  expect(reponse.ok()).toBeTruthy();
  const { profils } = await reponse.json();
  const profil = profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo");
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil.id;
}

async function idPremierClient(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/clients");
  expect(reponse.ok()).toBeTruthy();
  const clients = await reponse.json();
  expect(clients.length).toBeGreaterThan(0);
  return clients[0].id;
}

const TEMPLATES = ["contrat_prestation", "nda", "cdi", "freelance", "portage"];

test.describe("API — /api/generate-contract", () => {
  test("un Admin génère avec succès un .docx pour chacun des 5 modèles", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const clientId = await idPremierClient(request);
    const profilId = await idProfilIngenieurDemo(request);

    const creation = await request.post("/api/missions", {
      data: { clientId, profilId, nbJours: 3, tjmVente: 500, repere: "Test génération contrat" },
    });
    expect(creation.status()).toBe(201);
    const mission = await creation.json();

    for (const templateKey of TEMPLATES) {
      const reponse = await request.post("/api/generate-contract", {
        data: { missionId: mission.id, templateKey },
      });
      expect(reponse.status(), `génération "${templateKey}" devrait réussir`).toBe(200);
      expect(reponse.headers()["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      const buffer = Buffer.from(await reponse.body());
      // Un .docx est une archive ZIP : signature "PK" en tête de fichier.
      expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    }
  });

  test("rejette un templateKey inconnu (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const clientId = await idPremierClient(request);
    const profilId = await idProfilIngenieurDemo(request);
    const creation = await request.post("/api/missions", {
      data: { clientId, profilId, nbJours: 3, tjmVente: 500, repere: "Test template invalide" },
    });
    const mission = await creation.json();

    const reponse = await request.post("/api/generate-contract", {
      data: { missionId: mission.id, templateKey: "ce-modele-nexiste-pas" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("SÉCURITÉ : un Client ne peut pas générer de contrat (403)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const reponse = await request.post("/api/generate-contract", {
      data: { missionId: "peu-importe", templateKey: "contrat_prestation" },
    });
    expect(reponse.status()).toBe(403);
  });

  test("SÉCURITÉ : un Ingénieur ne peut pas générer de contrat (403)", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.post("/api/generate-contract", {
      data: { missionId: "peu-importe", templateKey: "contrat_prestation" },
    });
    expect(reponse.status()).toBe(403);
  });
});
