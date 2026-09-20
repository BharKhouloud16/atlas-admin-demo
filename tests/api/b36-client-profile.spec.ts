import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
// Couvre GET/PATCH /api/client/profil et POST /api/client/profil/faits —
// historique additif, supersession logique (confirmeDepuis), anti-doublon,
// singleton vs répétable, isolation client, IDOR/BOLA, accès non autorisé.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function lireProfil(request: APIRequestContext) {
  const reponse = await request.get("/api/client/profil");
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
  return reponse.json();
}

async function repondre(request: APIRequestContext, cle: string, action: "AJOUTER" | "CONFIRMER", extra: Record<string, unknown> = {}) {
  return request.post("/api/client/profil/faits", { data: { cle, action, ...extra } });
}

test.describe("COMPANY ATLAS LOT 4 — Profil Client (API)", () => {
  test.describe("GET — lecture et création paresseuse", () => {
    test("GET crée le profil au premier accès et retourne identité + résumés", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      expect(data.client.nom).toBeTruthy();
      expect(data.profile.id).toBeTruthy();
      expect(Array.isArray(data.faits)).toBe(true);
      expect(data.besoins).toHaveProperty("total");
      expect(data.resultats).toHaveProperty("missionsRealisees");
      expect(Array.isArray(data.signauxRecurrence)).toBe(true);
    });

    test("un second GET réutilise le même ClientProfile (pas de doublon créé)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const premier = await lireProfil(request);
      const second = await lireProfil(request);
      expect(second.profile.id).toBe(premier.profile.id);
    });
  });

  test.describe("PATCH — identité", () => {
    test("modifie un champ autorisé (secteur)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.fetch("/api/client/profil", { method: "PATCH", data: { secteur: "Industrie QA" } });
      expect(reponse.status(), await reponse.text()).toBe(200);
      expect((await reponse.json()).client.secteur).toBe("Industrie QA");
    });

    test("nom vide refusé (400) — jamais un nom effacé", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.fetch("/api/client/profil", { method: "PATCH", data: { nom: "   " } });
      expect(reponse.status()).toBe(400);
    });

    test("aucune modification fournie -> 400", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await request.fetch("/api/client/profil", { method: "PATCH", data: { champInconnu: "x" } });
      expect(reponse.status()).toBe(400);
    });
  });

  test.describe("AJOUTER — clé répétable", () => {
    test("crée un fait statut DECLARE, source client", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await repondre(request, "ENJEU", "AJOUTER", { valeur: `Pénurie de talents QA ${Date.now()}` });
      expect(reponse.status(), await reponse.text()).toBe(201);
      const { fait } = await reponse.json();
      expect(fait.statut).toBe("DECLARE");
      expect(fait.source).toBe("client");
      expect(fait.confirmeDepuis).toBeNull();
    });

    test("anti-doublon : une valeur déjà active (normalisée) est refusée (409)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const valeur = `Disponibilité stricte ${Date.now()}`;
      await repondre(request, "CONTRAINTE_DURABLE", "AJOUTER", { valeur });
      const doublon = await repondre(request, "CONTRAINTE_DURABLE", "AJOUTER", { valeur: `  ${valeur.toUpperCase()}  ` });
      expect(doublon.status()).toBe(409);
    });

    test("deux valeurs distinctes de la même clé répétable -> toutes deux actives simultanément", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const suffixe = Date.now();
      await repondre(request, "RISQUE_DURABLE", "AJOUTER", { valeur: `Turnover élevé ${suffixe}` });
      await repondre(request, "RISQUE_DURABLE", "AJOUTER", { valeur: `Dépendance à un seul fournisseur ${suffixe}` });
      const data = await lireProfil(request);
      const risques = data.faits.filter((f: { cle: string }) => f.cle === "RISQUE_DURABLE").map((f: { valeur: string }) => f.valeur);
      expect(risques).toContain(`Turnover élevé ${suffixe}`);
      expect(risques).toContain(`Dépendance à un seul fournisseur ${suffixe}`);
    });

    test("valeur vide refusée (400) — jamais une valeur inventée", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await repondre(request, "ENJEU", "AJOUTER", { valeur: "" });
      expect(reponse.status()).toBe(400);
    });

    test("clé hors périmètre (répétable ClientNeed ou inexistante) refusée (400)", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const competence = await repondre(request, "COMPETENCE", "AJOUTER", { valeur: "Java" });
      expect(competence.status()).toBe(400);
      const inexistante = await repondre(request, "CLE_INEXISTANTE", "AJOUTER", { valeur: "x" });
      expect(inexistante.status()).toBe(400);
    });
  });

  test.describe("AJOUTER — clé singleton (CONTEXTE_ACTIVITE)", () => {
    test("une nouvelle valeur remplace la précédente (dernière gagne), l'ancienne reste en base", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const suffixe = Date.now();
      await repondre(request, "CONTEXTE_ACTIVITE", "AJOUTER", { valeur: `Entreprise industrielle ${suffixe}` });
      await repondre(request, "CONTEXTE_ACTIVITE", "AJOUTER", { valeur: `Entreprise industrielle, forte saisonnalité ${suffixe}` });

      const data = await lireProfil(request);
      const contextes = data.faits.filter((f: { cle: string }) => f.cle === "CONTEXTE_ACTIVITE");
      expect(contextes.length).toBe(1);
      expect(contextes[0].valeur).toBe(`Entreprise industrielle, forte saisonnalité ${suffixe}`);

      const historiqueComplet = await prisma.clientProfileFact.findMany({
        where: { profileId: data.profile.id, cle: "CONTEXTE_ACTIVITE" },
      });
      expect(historiqueComplet.length).toBeGreaterThanOrEqual(2); // historique jamais supprimé
    });
  });

  test.describe("CONFIRMER — supersession logique", () => {
    test("crée une nouvelle ligne VERIFIE avec confirmeDepuis, l'original devient inactif mais reste en base", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const valeur = `Saisonnalité forte ${Date.now()}`;
      const creation = await repondre(request, "ENJEU", "AJOUTER", { valeur });
      const { fait: original } = await creation.json();

      const confirmation = await repondre(request, "ENJEU", "CONFIRMER", { factIdACopier: original.id });
      expect(confirmation.status(), await confirmation.text()).toBe(201);
      const { fait: confirme } = await confirmation.json();
      expect(confirme.statut).toBe("VERIFIE");
      expect(confirme.confirmeDepuis).toBe(original.id);
      expect(confirme.valeur).toBe(original.valeur);

      const data = await lireProfil(request);
      const enjeux = data.faits.filter((f: { cle: string; valeur: string }) => f.cle === "ENJEU" && f.valeur === valeur);
      expect(enjeux.length).toBe(1); // une seule instance active, jamais deux fois la même info
      expect(enjeux[0].id).toBe(confirme.id);

      const original_toujours_en_base = await prisma.clientProfileFact.findUnique({ where: { id: original.id } });
      expect(original_toujours_en_base).not.toBeNull(); // jamais supprimé
    });

    test("confirmer un fait déjà confirmé (superseded) -> 404, jamais deux instances actives pour la même info", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const creation = await repondre(request, "PREFERENCE_DURABLE", "AJOUTER", { valeur: `Communication hebdomadaire ${Date.now()}` });
      const { fait: original } = await creation.json();
      await repondre(request, "PREFERENCE_DURABLE", "CONFIRMER", { factIdACopier: original.id });

      const doubleConfirmation = await repondre(request, "PREFERENCE_DURABLE", "CONFIRMER", { factIdACopier: original.id });
      expect(doubleConfirmation.status()).toBe(404);
    });

    test("factIdACopier manquant ou vide -> 400", async ({ request }) => {
      await connecter(request, "client-demo@example.com");
      const reponse = await repondre(request, "ENJEU", "CONFIRMER", {});
      expect(reponse.status()).toBe(400);
    });
  });

  test.describe("Sécurité — isolation client / IDOR / BOLA", () => {
    test("non authentifié : 403 sur GET/PATCH/POST", async ({ request }) => {
      const get = await request.get("/api/client/profil");
      expect(get.status()).toBe(403);
      const patch = await request.fetch("/api/client/profil", { method: "PATCH", data: { secteur: "x" } });
      expect(patch.status()).toBe(403);
      const post = await repondre(request, "ENJEU", "AJOUTER", { valeur: "x" });
      expect(post.status()).toBe(403);
    });

    test("ADMIN / INGENIEUR : 403 sur toutes les routes /api/client/profil*", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const admin = await request.get("/api/client/profil");
      expect(admin.status()).toBe(403);

      await connecter(request, "ingenieur-demo@example.com");
      const ingenieur = await request.get("/api/client/profil");
      expect(ingenieur.status()).toBe(403);
    });

    test("IDOR — confirmer le fait d'un autre client (factIdACopier étranger) est refusé (404), aucune fuite, aucune écriture", async ({ request }) => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT4 IDOR ${Date.now()}` } });
      const autreProfil = await prisma.clientProfile.create({ data: { clientId: autreClient.id } });
      const autreFait = await prisma.clientProfileFact.create({
        data: { profileId: autreProfil.id, cle: "ENJEU", valeur: "Information confidentielle d'un autre client", statut: "DECLARE", source: "client" },
      });

      await connecter(request, "client-demo@example.com");
      const tentative = await repondre(request, "ENJEU", "CONFIRMER", { factIdACopier: autreFait.id });
      expect(tentative.status()).toBe(404);

      const faitsInchanges = await prisma.clientProfileFact.count({ where: { profileId: autreProfil.id } });
      expect(faitsInchanges).toBe(1); // aucune nouvelle ligne créée côté victime

      const data = await lireProfil(request);
      expect(data.faits.some((f: { valeur: string }) => f.valeur === "Information confidentielle d'un autre client")).toBe(false);
    });

    test("un client ne voit jamais les faits de profil d'un autre client dans son propre GET", async ({ request }) => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT4 Isolation ${Date.now()}` } });
      const autreProfil = await prisma.clientProfile.create({ data: { clientId: autreClient.id } });
      await prisma.clientProfileFact.create({
        data: { profileId: autreProfil.id, cle: "RISQUE_DURABLE", valeur: "Risque propre à un autre client", statut: "DECLARE", source: "client" },
      });

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      expect(data.faits.some((f: { valeur: string }) => f.valeur === "Risque propre à un autre client")).toBe(false);
      expect(data.profile.id).not.toBe(autreProfil.id);
    });

    test("clientId fourni dans le corps de PATCH est structurellement ignoré — toujours celui de la session", async ({ request }) => {
      const autreClient = await prisma.client.create({ data: { nom: `Client LOT4 Spoof ${Date.now()}` } });
      const nomAvant = autreClient.nom;

      await connecter(request, "client-demo@example.com");
      const reponse = await request.fetch("/api/client/profil", {
        method: "PATCH",
        data: { secteur: "Tentative", clientId: autreClient.id, id: autreClient.id },
      });
      expect(reponse.status()).toBe(200);

      const autreClientRelu = await prisma.client.findUnique({ where: { id: autreClient.id } });
      expect(autreClientRelu?.nom).toBe(nomAvant);
      expect(autreClientRelu?.secteur).not.toBe("Tentative");
    });
  });
});
