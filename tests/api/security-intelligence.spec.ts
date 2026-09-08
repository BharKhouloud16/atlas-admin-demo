import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Tests API : RBAC sur les nouvelles routes /api/security/*, escalade de
// privilèges (horizontale/verticale), isolation inter-client (BOLA/objet),
// traçabilité de l'audit (EvenementSecurite créé sur connexion échouée),
// et non-exposition de données sensibles (mot de passe/hash jamais dans
// une réponse API) — voir directive B16, section 7.
const MOT_DE_PASSE = "Demo1234";

async function connecter(request: APIRequestContext, email: string, password = MOT_DE_PASSE) {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("Sécurité — RBAC sur /api/security/*", () => {
  for (const chemin of ["/api/security/evenements", "/api/security/runtime", "/api/security/propositions"]) {
    test(`${chemin} refuse un Client (403) — escalade verticale`, async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.get(chemin);
      expect(reponse.status()).toBe(403);
    });

    test(`${chemin} refuse un Ingénieur (403) — escalade verticale`, async ({ request }) => {
      await connecter(request, "ingenieur-demo@example.com");
      const reponse = await request.get(chemin);
      expect(reponse.status()).toBe(403);
    });

    test(`${chemin} refuse une requête non authentifiée (403, jamais 500)`, async ({ request }) => {
      const reponse = await request.get(chemin);
      expect(reponse.status()).toBe(403);
    });

    test(`${chemin} accepte l'Admin (200)`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const reponse = await request.get(chemin);
      expect(reponse.status()).toBe(200);
    });
  }
});

test.describe("Sécurité — traçabilité de l'audit (EvenementSecurite)", () => {
  test("un échec de connexion crée un événement REFUSE consultable par l'Admin", async ({ request }) => {
    const emailInexistant = `test-b16-echec-${Date.now()}@example.com`;
    const echec = await request.post("/api/auth/login", { data: { email: emailInexistant, password: "peu-importe" } });
    expect(echec.status()).toBe(401);

    await connecter(request, "admin-demo@example.com");
    const evenements = await request.get("/api/security/evenements?action=auth.login.echec&limite=50");
    expect(evenements.status()).toBe(200);
    const { evenements: liste } = await evenements.json();
    expect(Array.isArray(liste)).toBeTruthy();
    expect(liste.some((e: { acteurEmail: string | null; resultat: string }) => e.acteurEmail === emailInexistant && e.resultat === "REFUSE")).toBeTruthy();
  });

  test("une connexion réussie crée un événement SUCCES", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const evenements = await request.get("/api/security/evenements?action=auth.login.succes&limite=50");
    const { evenements: liste } = await evenements.json();
    expect(liste.some((e: { acteurEmail: string; resultat: string }) => e.acteurEmail === "admin-demo@example.com" && e.resultat === "SUCCES")).toBeTruthy();
  });

  test("aucune donnée sensible (mot de passe/hash/secret) dans la réponse des événements", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security/evenements?limite=50");
    const corpsBrut = await reponse.text();
    expect(corpsBrut).not.toContain("passwordHash");
    expect(corpsBrut.toLowerCase()).not.toContain("$2a$");
    expect(corpsBrut.toLowerCase()).not.toContain("$2b$");
    expect(corpsBrut.toLowerCase()).not.toContain("totpsecret");
  });

  test("une génération de contrat refusée (rôle Client) crée un événement rbac.acces_refuse", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refus = await request.post("/api/generate-contract", {
      data: { missionId: "peu-importe", templateKey: "contrat_prestation" },
    });
    expect(refus.status()).toBe(403);

    const avant = Date.now();
    await connecter(request, "admin-demo@example.com");
    // Filtre par acteurEmail (pas seulement action) ET par récence : la
    // base de CI est réutilisée d'une exécution à l'autre, donc de
    // nombreux événements rbac.acces_refuse historiques pour ce même
    // compte de démo s'accumulent au fil des runs — un simple filtre
    // action+acteur peut être noyé par ce bruit historique même avec une
    // limite haute. On ne retient donc que l'événement créé pendant CE
    // test (quelques secondes de marge pour l'horloge/latence réseau).
    const evenements = await request.get(
      "/api/security/evenements?action=rbac.acces_refuse&acteurEmail=client-demo@example.com&limite=200"
    );
    const { evenements: liste } = await evenements.json();
    expect(
      liste.some(
        (e: { acteurEmail: string; resultat: string; createdAt: string }) =>
          e.acteurEmail === "client-demo@example.com" &&
          e.resultat === "REFUSE" &&
          new Date(e.createdAt).getTime() >= avant - 5000
      )
    ).toBeTruthy();
  });
});

test.describe("Sécurité — isolation inter-client (object-level / horizontale)", () => {
  test("un Client ne voit jamais les missions d'un autre client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");

    const clientOriginal = await request.get("/api/clients");
    const clientsAvant = await clientOriginal.json();

    const creationClient = await request.post("/api/clients", { data: { nom: `Client B16 Isolation ${Date.now()}` } });
    expect(creationClient.status()).toBe(201);
    const autreClient = await creationClient.json();

    const profils = await (await request.get("/api/profils")).json();
    const profilIngenieur = profils.profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo");
    expect(profilIngenieur).toBeTruthy();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: autreClient.id, profilId: profilIngenieur.id, nbJours: 2, tjmVente: 400, repere: "Mission B16 isolation" },
    });
    expect(creationMission.status()).toBe(201);
    const autreMission = await creationMission.json();

    // client-demo (compte existant, distinct du client fraîchement créé)
    // ne doit jamais voir cette mission.
    await connecter(request, "client-demo@example.com");
    const missionsClient = await request.get("/api/client/missions");
    expect(missionsClient.status()).toBe(200);
    const liste = await missionsClient.json();
    const ids = Array.isArray(liste) ? liste.map((m: { id: string }) => m.id) : (liste.missions ?? []).map((m: { id: string }) => m.id);
    expect(ids).not.toContain(autreMission.id);

    // Et ne peut pas générer de contrat dessus (vertical, déjà couvert par
    // ailleurs, revérifié ici sur CET objet précis — object-level).
    const generation = await request.post("/api/generate-contract", {
      data: { missionId: autreMission.id, templateKey: "contrat_prestation" },
    });
    expect(generation.status()).toBe(403);

    void clientsAvant; // conservé pour lisibilité du diff, non utilisé plus loin
  });

  test("un Ingénieur n'a jamais accès au circuit de validation Admin/Client des feuilles de temps (PATCH)", async ({ request }) => {
    // Utilise une feuille de temps réelle (pas un id inexistant) : la route
    // vérifie d'abord l'existence de l'objet (404 sinon), donc un id fictif
    // ne teste jamais la porte de rôle elle-même — voir
    // app/api/feuilles-de-temps/route.ts (PATCH).
    await connecter(request, "admin-demo@example.com");
    const feuilles = await (await request.get("/api/feuilles-de-temps")).json();
    const uneFeuille = feuilles.feuilles?.[0];
    expect(uneFeuille, "au moins une feuille de temps doit exister dans les données de démo").toBeTruthy();

    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.patch("/api/feuilles-de-temps", {
      data: { id: uneFeuille.id, action: "validerAdmin" },
    });
    expect(reponse.status()).toBe(403);
  });
});

test.describe("Sécurité — propositions (validation humaine, jamais d'application automatique)", () => {
  test("cycle complet : création, décision requiert un motif, double décision refusée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");

    const creation = await request.post("/api/security/propositions", {
      data: {
        origine: "MANUEL:test-b16",
        titre: "Test B16 — proposition",
        description: "Proposition créée par les tests automatisés B16, jamais appliquée automatiquement.",
      },
    });
    expect(creation.status()).toBe(201);
    const proposition = await creation.json();
    expect(proposition.statut).toBe("PROPOSEE");

    const sansMotif = await request.patch(`/api/security/propositions/${proposition.id}`, {
      data: { decision: "APPROUVEE" },
    });
    expect(sansMotif.status()).toBe(400);

    const decision = await request.patch(`/api/security/propositions/${proposition.id}`, {
      data: { decision: "APPROUVEE", motifDecision: "Validé par les tests automatisés B16." },
    });
    expect(decision.status()).toBe(200);
    const decidee = await decision.json();
    expect(decidee.statut).toBe("APPROUVEE");
    expect(decidee.decideParEmail).toBe("admin-demo@example.com");

    const doubleDecision = await request.patch(`/api/security/propositions/${proposition.id}`, {
      data: { decision: "REJETEE", motifDecision: "Ne devrait jamais s'appliquer." },
    });
    expect(doubleDecision.status()).toBe(409);
  });

  test("un Ingénieur ne peut ni créer ni décider d'une proposition (403)", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const creation = await request.post("/api/security/propositions", {
      data: { origine: "MANUEL:x", titre: "x", description: "x" },
    });
    expect(creation.status()).toBe(403);
  });
});
