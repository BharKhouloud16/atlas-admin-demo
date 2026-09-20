import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification (15/09/2026).
// Couvre l'endpoint dédié POST /api/client/besoins/[id]/faits (CONFIRMER/
// CORRIGER), l'historique additif (jamais d'écrasement), le recalcul de
// cohérence, la transition automatique A_CLARIFIER pilotée par le serveur,
// et l'isolation client/IDOR/BOLA — via les routes réelles.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

type BesoinAvecFaits = {
  id: string;
  clientId: string;
  statut: string;
  coherenceStatut: string;
  coherenceDetail: { regle: string; statut: string; explication: string }[] | null;
  faits: { id: string; cle: string; valeur: string; statut: string; source: string | null; createdAt: string }[];
};

async function creerBesoin(request: APIRequestContext, texteOriginal: string): Promise<BesoinAvecFaits> {
  const reponse = await request.post("/api/client/besoins", { data: { texteOriginal } });
  expect(reponse.status(), await reponse.text()).toBe(201);
  return (await reponse.json()).besoin as BesoinAvecFaits;
}

async function relire(request: APIRequestContext, id: string): Promise<BesoinAvecFaits> {
  const reponse = await request.get(`/api/client/besoins/${id}`);
  expect(reponse.ok()).toBeTruthy();
  return (await reponse.json()).besoin as BesoinAvecFaits;
}

async function repondre(
  request: APIRequestContext,
  besoinId: string,
  cle: string,
  action: "CONFIRMER" | "CORRIGER",
  valeur?: string
) {
  return request.post(`/api/client/besoins/${besoinId}/faits`, { data: { cle, action, valeur } });
}

test.describe("COMPANY ATLAS LOT 3 — Client Need Validation & Clarification (API)", () => {
  test.describe("Historique additif — jamais d'écrasement", () => {
    test("CORRIGER crée une nouvelle ligne, l'ancienne valeur reste en base", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur React confirmé.");
      const avant = besoin.faits.length;

      const reponse = await repondre(request, besoin.id, "ROLE", "CORRIGER", "Tech Lead");
      expect(reponse.status(), await reponse.text()).toBe(201);

      const tousLesFaits = await prisma.clientNeedFait.findMany({ where: { needId: besoin.id, cle: "ROLE" }, orderBy: { createdAt: "asc" } });
      expect(tousLesFaits.length).toBeGreaterThanOrEqual(1);
      expect(tousLesFaits[tousLesFaits.length - 1].valeur).toBe("Tech Lead");
      // Si une valeur ROLE existait déjà (extraction), elle doit rester intacte.
      if (tousLesFaits.length > 1) {
        expect(tousLesFaits[0].valeur).not.toBe("Tech Lead");
      }

      const relu = await relire(request, besoin.id);
      expect(relu.faits.length).toBe(avant + 1);
    });

    test("CONFIRMER crée une nouvelle preuve statut VERIFIE, source client_confirmation, valeur inchangée", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un profil senior en Java.");
      const seniorite = besoin.faits.find((f) => f.cle === "SENIORITE");
      expect(seniorite?.valeur).toBe("Senior");

      const reponse = await repondre(request, besoin.id, "SENIORITE", "CONFIRMER");
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { besoin: misAJour } = await reponse.json();
      const nouveauFait = misAJour.faits.find((f: { source: string | null }) => f.source === "client_confirmation");
      expect(nouveauFait.cle).toBe("SENIORITE");
      expect(nouveauFait.valeur).toBe("Senior");
      expect(nouveauFait.statut).toBe("VERIFIE");
    });

    test("dernière valeur correctement déterminée après plusieurs corrections successives sur la même clé", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      // REMOTE n'est pas dans CLES_IMPORTANTES_SI_ABSENTES : aucune ligne
      // INCONNU n'est créée à la création, on part d'un historique vide
      // pour cette clé — isole strictement le comportement testé ici.
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");

      await repondre(request, besoin.id, "REMOTE", "CORRIGER", "Sur site");
      await repondre(request, besoin.id, "REMOTE", "CORRIGER", "Hybride");
      const derniere = await repondre(request, besoin.id, "REMOTE", "CORRIGER", "Full remote");
      expect(derniere.status()).toBe(201);

      const historique = await prisma.clientNeedFait.findMany({ where: { needId: besoin.id, cle: "REMOTE" }, orderBy: { createdAt: "asc" } });
      expect(historique.length).toBe(3);
      expect(historique.map((f) => f.valeur)).toEqual(["Sur site", "Hybride", "Full remote"]);
    });
  });

  test.describe("Validation — aucune valeur inventée", () => {
    test("CORRIGER sans valeur est refusé (400)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");
      const reponse = await repondre(request, besoin.id, "ROLE", "CORRIGER");
      expect(reponse.status()).toBe(400);
    });

    test("CONFIRMER sur une clé sans valeur actuelle est refusé (400) — rien à confirmer", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");
      // BUDGET_FREQUENCE n'est jamais extraite par l'heuristique locale.
      const reponse = await repondre(request, besoin.id, "BUDGET_FREQUENCE", "CONFIRMER");
      expect(reponse.status()).toBe(400);
    });

    test("clé répétable ou hors vocabulaire est refusée (400) — périmètre LOT 3 strictement limité", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur Java.");
      const repetable = await repondre(request, besoin.id, "COMPETENCE", "CORRIGER", "Python");
      expect(repetable.status()).toBe(400);
      const invalide = await repondre(request, besoin.id, "CLE_INEXISTANTE", "CORRIGER", "x");
      expect(invalide.status()).toBe(400);
    });
  });

  test.describe("Recalcul de cohérence et pilotage automatique de A_CLARIFIER", () => {
    test("la création reste inchangée (LOT 2, toujours SOUMIS) — le pilotage automatique de A_CLARIFIER n'intervient qu'après une réponse (périmètre LOT 3)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Je veux un profil junior avec 10 ans d'expérience.");
      expect(besoin.coherenceStatut).toBe("INCONSISTENT");
      expect(besoin.statut).toBe("SOUMIS");
    });

    test("le premier appel à /faits fait passer un besoin incohérent en A_CLARIFIER — jamais une incohérence silencieuse une fois la boucle de clarification engagée", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Je veux un profil junior avec 10 ans d'expérience.");
      expect(besoin.statut).toBe("SOUMIS");

      // Répondre à une clarification — même une qui ne résout pas la
      // contradiction d'origine — déclenche le recalcul et le pilotage
      // automatique du statut (décision CEO LOT 3, point 4).
      const reponse = await repondre(request, besoin.id, "DUREE", "CORRIGER", "6 mois");
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { besoin: misAJour } = await reponse.json();
      expect(misAJour.coherenceStatut).toBe("INCONSISTENT");
      expect(misAJour.statut).toBe("A_CLARIFIER");
    });

    test("correction résolvant la contradiction fait disparaître la règle INCONSISTENT du diagnostic", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Je veux un profil junior avec 10 ans d'expérience.");

      const reponse = await repondre(request, besoin.id, "SENIORITE", "CORRIGER", "Senior");
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { besoin: misAJour } = await reponse.json();
      expect(misAJour.coherenceStatut).not.toBe("INCONSISTENT");
      expect((misAJour.coherenceDetail ?? []).some((r: { regle: string; statut: string }) => r.regle === "SENIORITE_EXPERIENCE" && r.statut === "INCONSISTENT")).toBe(false);
    });

    test("sortie automatique de A_CLARIFIER une fois toutes les clarifications résolues", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Je veux un profil junior avec 10 ans d'expérience.");
      expect(besoin.statut).toBe("SOUMIS"); // inchangé à la création (LOT 2)

      const premiere = await repondre(request, besoin.id, "SENIORITE", "CORRIGER", "Senior");
      expect((await premiere.json()).besoin.statut).toBe("A_CLARIFIER"); // des manques importants subsistent encore

      await repondre(request, besoin.id, "ROLE", "CORRIGER", "QA");
      await repondre(request, besoin.id, "BUDGET_MONTANT", "CORRIGER", "500");
      await repondre(request, besoin.id, "LOCALISATION", "CORRIGER", "France");
      await repondre(request, besoin.id, "DISPONIBILITE", "CORRIGER", "Immédiate");
      const derniere = await repondre(request, besoin.id, "DUREE", "CORRIGER", "6 mois");
      expect(derniere.status(), await derniere.text()).toBe(201);

      const final = await relire(request, besoin.id);
      expect(final.statut).toBe("SOUMIS");
      expect(final.coherenceStatut).not.toBe("INCONSISTENT");
      expect(final.coherenceStatut).not.toBe("NEEDS_CLARIFICATION");
    });

    test("une correction peut aussi FAIRE APPARAÎTRE une contradiction (jamais silencieuse), et repasser le besoin en A_CLARIFIER", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");

      // Résout d'abord tous les manques importants pour atteindre un état
      // réellement SOUMIS (aucune clarification en attente), afin d'isoler
      // strictement l'effet de la contradiction introduite ensuite.
      await repondre(request, besoin.id, "ROLE", "CORRIGER", "Développeur");
      await repondre(request, besoin.id, "SENIORITE", "CORRIGER", "Senior");
      await repondre(request, besoin.id, "BUDGET_MONTANT", "CORRIGER", "500");
      await repondre(request, besoin.id, "LOCALISATION", "CORRIGER", "France");
      await repondre(request, besoin.id, "DISPONIBILITE", "CORRIGER", "Immédiate");
      const complet = await repondre(request, besoin.id, "DUREE", "CORRIGER", "6 mois");
      expect(complet.status(), await complet.text()).toBe(201);
      const avant = (await complet.json()).besoin;
      expect(avant.statut).toBe("SOUMIS");

      await repondre(request, besoin.id, "SENIORITE", "CORRIGER", "Junior");
      const reponse = await repondre(request, besoin.id, "ANNEES_EXPERIENCE_MIN", "CORRIGER", "10");
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { besoin: misAJour } = await reponse.json();

      expect(misAJour.coherenceStatut).toBe("INCONSISTENT");
      expect(misAJour.statut).toBe("A_CLARIFIER");
    });

    test("un besoin VALIDE n'est jamais automatiquement repassé en A_CLARIFIER par une correction", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");
      const valide = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "VALIDE" } });
      expect(valide.status()).toBe(200);

      await repondre(request, besoin.id, "SENIORITE", "CORRIGER", "Junior");
      const reponse = await repondre(request, besoin.id, "ANNEES_EXPERIENCE_MIN", "CORRIGER", "10");
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { besoin: misAJour } = await reponse.json();

      expect(misAJour.coherenceStatut).toBe("INCONSISTENT"); // le diagnostic reste honnête...
      expect(misAJour.statut).toBe("VALIDE"); // ...mais le statut piloté par le client n'est jamais forcé par le serveur
    });
  });

  test.describe("Le client ne peut jamais forcer A_CLARIFIER directement", () => {
    test("PATCH statut=A_CLARIFIER est refusé (400) — exclusivement piloté par le serveur", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");
      const reponse = await request.fetch(`/api/client/besoins/${besoin.id}`, { method: "PATCH", data: { statut: "A_CLARIFIER" } });
      expect(reponse.status()).toBe(400);
    });
  });

  test.describe("Sécurité — isolation client / IDOR / BOLA", () => {
    test("répondre à une clarification du besoin d'un autre client est refusé (404), aucune fuite, aucune écriture", async ({ request }) => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT3 Isolation ${Date.now()}` } });
      const autreBesoin = await prisma.clientNeed.create({
        data: {
          clientId: autreClient.id,
          correlationId: `b35-isolation-${Date.now()}`,
          texteOriginal: "Besoin confidentiel d'un autre client.",
          statut: "SOUMIS",
          faits: { create: [{ cle: "ROLE", valeur: "QA", statut: "DECLARE", source: "extraction" }] },
        },
        include: { faits: true },
      });

      await connecter(request, "client-demo@example.com");
      const reponse = await repondre(request, autreBesoin.id, "ROLE", "CONFIRMER");
      expect(reponse.status()).toBe(404);

      const faitsInchanges = await prisma.clientNeedFait.count({ where: { needId: autreBesoin.id } });
      expect(faitsInchanges).toBe(1); // aucune nouvelle ligne créée
    });

    test("non authentifié : 403 sur POST /api/client/besoins/[id]/faits", async ({ request }) => {
      // Appelé avant toute connexion dans ce test — aucun cookie de session.
      const sansSession = await repondre(request, "inexistant", "ROLE", "CONFIRMER");
      expect(sansSession.status()).toBe(403);
    });

    test("ADMIN / INGENIEUR : 403 sur POST /api/client/besoins/[id]/faits — aucun accès client implicite", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const besoin = await creerBesoin(request, "Nous cherchons un développeur.");

      await connecter(request, "admin-demo@example.com");
      const admin = await repondre(request, besoin.id, "ROLE", "CONFIRMER");
      expect(admin.status()).toBe(403);

      await connecter(request, "ingenieur-demo@example.com");
      const ingenieur = await repondre(request, besoin.id, "ROLE", "CONFIRMER");
      expect(ingenieur.status()).toBe(403);
    });
  });
});
