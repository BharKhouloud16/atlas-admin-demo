import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.3 (20/09/2026) : Communication Intelligence + Attention
// Center — API Client/Admin.
//
// Même discipline anti-volume-de-connexions que les fichiers V2.2-B/C/D/E
// précédents : état "donné" construit directement via Prisma, une seule
// connexion HTTP par test pour ce qui est effectivement sous test.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idProfilIngenieurDemo(): Promise<string> {
  const profil = await prisma.profil.findFirst({ where: { nom: "Ingénieur Démo" } });
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil!.id;
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test Attention ${suffixe}` } });
}

async function factureDeTest(clientId: string, overrides: { statut?: string; montantTTC?: number; dateEcheance?: Date | null; dateEnvoi?: Date | null } = {}) {
  const profilId = await idProfilIngenieurDemo();
  const montantTTC = overrides.montantTTC ?? 1000;
  const mission = await prisma.mission.create({
    data: { clientId, profilId, nbJours: 1, tjmVente: montantTTC, deviseVente: "EUR", repere: `Test attention ${Date.now()}-${Math.random()}` },
  });
  const maintenant = new Date();
  const feuille = await prisma.feuilleDeTemps.create({
    data: {
      missionId: mission.id,
      mois: `2029-${String((Math.floor(Math.random() * 12) + 1)).padStart(2, "0")}`,
      joursTravailles: 1,
      heuresSupplementaires: 0,
      statut: "ValideeClient",
      soumiseLe: maintenant,
      valideeAdminLe: maintenant,
      valideeClientLe: maintenant,
    },
  });
  const facture = await prisma.facture.create({
    data: {
      clientId,
      missionId: mission.id,
      feuilleDeTempsId: feuille.id,
      numeroFacture: `FA-TESTATT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      statut: (overrides.statut ?? "ENVOYEE") as never,
      montantHT: montantTTC,
      montantTVA: 0,
      montantTTC,
      devise: "EUR",
      dateEmission: maintenant,
      dateEcheance: overrides.dateEcheance === undefined ? new Date(maintenant.getTime() - 24 * 60 * 60 * 1000) : overrides.dateEcheance,
      dateEnvoi: overrides.dateEnvoi === undefined ? maintenant : overrides.dateEnvoi,
    },
  });
  return facture;
}

async function besoinDeTest(clientId: string, statut: string) {
  return prisma.clientNeed.create({
    data: { clientId, correlationId: `corr-${Date.now()}-${Math.random()}`, texteOriginal: "Besoin de test.", statut: statut as never },
  });
}

test.describe("V2.3 — RBAC : Attention réservée Client/Admin, jamais Ingénieur", () => {
  test("un Ingénieur ne peut jamais lister ses Attention (il n'en a structurellement aucune)", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.get("/api/client/attentions");
    expect(reponse.status()).toBe(403);
  });

  test("un Client ne peut jamais accéder à la liste Admin", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const reponse = await request.get("/api/admin/attentions");
    expect(reponse.status()).toBe(403);
  });

  test("non authentifié -> 403 sur les deux routes", async ({ request }) => {
    expect((await request.get("/api/client/attentions")).status()).toBe(403);
    expect((await request.get("/api/admin/attentions")).status()).toBe(403);
  });
});

test.describe("V2.3 — Synchronisation Billing -> Attention (delta réel de ce lot)", () => {
  test("une Facture en retard produit une Attention FACTURE_ECHUE visible par son Client", async ({ request }) => {
    const client = await creerClientDeTest("echue");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });

    // Synchronisation déclenchée par la route Admin (balayage global) —
    // jamais besoin de connecter le Client de test lui-même (aucun compte
    // n'existe pour lui, seul le Client Prisma a été créé).
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    const attention = corps.attentions.find((a: { type: string; sourceId: string }) => a.type === "FACTURE_ECHUE" && a.sourceId === facture.id);
    expect(attention).toBeTruthy();
    expect(attention.clientId).toBe(client.id);
  });

  test("payer intégralement une Facture ECHUE la résout et fait apparaître PAIEMENT_RECU (jamais les deux à la fois)", async ({ request }) => {
    const client = await creerClientDeTest("resolution");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE", montantTTC: 500 });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`); // 1ère sync : FACTURE_ECHUE ouverte

    await request.post(`/api/factures/${facture.id}/paiements`, { data: { montant: 500, devise: "EUR", reference: `REF-${Date.now()}`, methode: "Virement" } });

    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    const echue = corps.attentions.find((a: { type: string; sourceId: string }) => a.type === "FACTURE_ECHUE" && a.sourceId === facture.id);
    const recue = corps.attentions.find((a: { type: string; sourceId: string }) => a.type === "PAIEMENT_RECU" && a.sourceId === facture.id);
    expect(echue.statut).toBe("RESOLUE"); // le fait métier ne s'applique plus -> auto-résolu
    expect(recue).toBeTruthy();
    expect(recue.statut).toBe("OUVERTE");
  });

  test("idempotence : synchroniser deux fois la même Facture ne crée jamais deux lignes pour le même type", async ({ request }) => {
    const client = await creerClientDeTest("idempotence");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    const lignes = await prisma.attention.findMany({ where: { source: "Facture", sourceId: facture.id, type: "FACTURE_ECHUE" } });
    expect(lignes).toHaveLength(1);
  });

  test("concurrence : deux synchronisations simultanées de la même Facture ne créent jamais de doublon", async ({ request }) => {
    const client = await creerClientDeTest("concurrence");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });

    await connecter(request, "admin-demo@example.com");
    await Promise.all([
      request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`),
      request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`),
      request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`),
    ]);

    const lignes = await prisma.attention.findMany({ where: { source: "Facture", sourceId: facture.id, type: "FACTURE_ECHUE" } });
    expect(lignes).toHaveLength(1);
  });

  test("une anomalie financière est visible côté Admin mais n'apparaît jamais côté Client", async ({ request }) => {
    const client = await creerClientDeTest("anomalie");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });
    // Corruption directe en base (jamais atteignable via l'API réelle,
    // seul un scénario de données corrompues / migration future) — même
    // principe que tests/unit/b44-billing-rapport-financier.spec.ts pour
    // detecterAnomalies().
    await prisma.facture.update({ where: { id: facture.id }, data: { montantTTC: -1 } });

    await connecter(request, "admin-demo@example.com");
    const reponseAdmin = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corpsAdmin = await reponseAdmin.json();
    expect(corpsAdmin.attentions.some((a: { type: string }) => a.type === "ANOMALIE_FINANCIERE")).toBeTruthy();

    const enBase = await prisma.attention.findMany({ where: { type: "ANOMALIE_FINANCIERE", sourceId: facture.id } });
    expect(enBase).toHaveLength(1);
    expect(enBase[0].recipientType).toBe("ADMIN");
    expect(enBase[0].recipientId).toBeNull();
  });

  test("un besoin A_CLARIFIER produit une Attention BESOIN_A_CLARIFIER, catégorie ACTION_REQUISE", async ({ request }) => {
    const client = await creerClientDeTest("besoin");
    const besoin = await besoinDeTest(client.id, "A_CLARIFIER");

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    const attention = corps.attentions.find((a: { sourceId: string }) => a.sourceId === besoin.id);
    expect(attention.type).toBe("BESOIN_A_CLARIFIER");
    expect(attention.categorie).toBe("ACTION_REQUISE");
  });
});

test.describe("V2.3 — IDOR/BOLA : un Client ne voit et ne modifie jamais l'Attention d'un autre Client (mandat section 6)", () => {
  test("GET /api/client/attentions du Client réel ne renvoie jamais l'Attention d'un autre Client", async ({ request }) => {
    const autreClient = await creerClientDeTest("idor-autre");
    await factureDeTest(autreClient.id, { statut: "ENVOYEE" });

    await connecter(request, "client-demo@example.com");
    const reponse = await request.get("/api/client/attentions?historique=1");
    const corps = await reponse.json();
    // Toutes les Attention renvoyées doivent être scopées au Client
    // connecté — vérifié indirectement : aucune ne référence la Facture de
    // l'autre Client (impossible à distinguer autrement depuis la réponse
    // Client-safe, qui n'expose jamais clientId — voir adapterAttentionClient).
    const factureAutreClient = await prisma.attention.findFirst({ where: { recipientId: autreClient.id } });
    expect(factureAutreClient).toBeTruthy();
    expect(corps.attentions.some((a: { id: string }) => a.id === factureAutreClient!.id)).toBeFalsy();
  });

  test("PATCH /api/client/attentions/[id] sur une Attention d'un autre Client -> 404 (jamais 403 : aucune fuite d'existence)", async ({ request }) => {
    const autreClient = await creerClientDeTest("idor-patch-autre");
    await factureDeTest(autreClient.id, { statut: "ENVOYEE" });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${autreClient.id}&historique=1`); // déclenche la synchronisation
    const attentionAutreClient = await prisma.attention.findFirst({ where: { recipientType: "CLIENT", recipientId: autreClient.id } });
    expect(attentionAutreClient).toBeTruthy();

    await connecter(request, "client-demo@example.com");
    const reponse = await request.patch(`/api/client/attentions/${attentionAutreClient!.id}`, { data: { action: "lire" } });
    expect(reponse.status()).toBe(404);

    const enBase = await prisma.attention.findUnique({ where: { id: attentionAutreClient!.id } });
    expect(enBase!.readAt).toBeNull(); // jamais modifiée par la tentative refusée
  });

  test("PATCH Admin sur une Attention CLIENT -> 404 (cette route n'agit jamais sur une Attention destinée à un Client)", async ({ request }) => {
    const client = await creerClientDeTest("idor-admin-sur-client");
    await factureDeTest(client.id, { statut: "ENVOYEE" });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const attentionClient = await prisma.attention.findFirst({ where: { recipientType: "CLIENT", recipientId: client.id } });
    expect(attentionClient).toBeTruthy();

    const reponse = await request.patch(`/api/admin/attentions/${attentionClient!.id}`, { data: { action: "lire" } });
    expect(reponse.status()).toBe(404);
  });

  test("PATCH sur une Attention inexistante -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.patch("/api/admin/attentions/id-inexistant", { data: { action: "lire" } });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("V2.3 — Read/unread et résolution manuelle", () => {
  test("marquer une Attention Admin comme lue met à jour son statut et readAt, jamais resolvedAt", async ({ request }) => {
    const client = await creerClientDeTest("lecture");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });
    await prisma.facture.update({ where: { id: facture.id }, data: { montantTTC: -1 } });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const anomalie = await prisma.attention.findFirst({ where: { type: "ANOMALIE_FINANCIERE", sourceId: facture.id } });

    const reponse = await request.patch(`/api/admin/attentions/${anomalie!.id}`, { data: { action: "lire" } });
    expect(reponse.ok()).toBeTruthy();
    const enBase = await prisma.attention.findUnique({ where: { id: anomalie!.id } });
    expect(enBase!.statut).toBe("LUE");
    expect(enBase!.readAt).toBeTruthy();
    expect(enBase!.resolvedAt).toBeNull();
  });

  test("une ANOMALIE_FINANCIERE (ALERTE) ne peut jamais être résolue manuellement -> 409", async ({ request }) => {
    const client = await creerClientDeTest("resolution-refusee");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });
    await prisma.facture.update({ where: { id: facture.id }, data: { montantTTC: -1 } });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const anomalie = await prisma.attention.findFirst({ where: { type: "ANOMALIE_FINANCIERE", sourceId: facture.id } });

    const reponse = await request.patch(`/api/admin/attentions/${anomalie!.id}`, { data: { action: "resoudre" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.attention.findUnique({ where: { id: anomalie!.id } });
    expect(enBase!.statut).not.toBe("RESOLUE");
  });

  test("action invalide -> 400", async ({ request }) => {
    const client = await creerClientDeTest("action-invalide");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });
    await prisma.facture.update({ where: { id: facture.id }, data: { montantTTC: -1 } }); // pour obtenir une Attention ADMIN valide

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const attention = await prisma.attention.findFirst({ where: { sourceId: facture.id, recipientType: "ADMIN" } });
    expect(attention).toBeTruthy();

    const reponse = await request.patch(`/api/admin/attentions/${attention!.id}`, { data: { action: "supprimer" } });
    expect(reponse.status()).toBe(400);
  });

  test("tout-lire Admin ne marque lues que les Attention ADMIN, jamais les Attention CLIENT", async ({ request }) => {
    const client = await creerClientDeTest("tout-lire");
    const facture = await factureDeTest(client.id, { statut: "ENVOYEE" });
    await prisma.facture.update({ where: { id: facture.id }, data: { montantTTC: -1 } });

    await connecter(request, "admin-demo@example.com");
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    const avant = await prisma.attention.findMany({ where: { sourceId: facture.id } });
    expect(avant.some((a) => a.recipientType === "CLIENT" && a.statut === "OUVERTE")).toBeTruthy();
    expect(avant.some((a) => a.recipientType === "ADMIN" && a.statut === "OUVERTE")).toBeTruthy();

    await request.post("/api/admin/attentions/tout-lire");

    const apres = await prisma.attention.findMany({ where: { sourceId: facture.id } });
    expect(apres.find((a) => a.recipientType === "ADMIN")!.statut).toBe("LUE");
    expect(apres.find((a) => a.recipientType === "CLIENT")!.statut).toBe("OUVERTE"); // jamais touchée par le tout-lire Admin
  });
});

test.describe("V2.3 — Filtres Admin (mandat section 13)", () => {
  test("le filtre type restreint bien la liste retournée", async ({ request }) => {
    const client = await creerClientDeTest("filtre-type");
    await factureDeTest(client.id, { statut: "ENVOYEE" }); // FACTURE_ECHUE
    await besoinDeTest(client.id, "A_CLARIFIER"); // BESOIN_A_CLARIFIER

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&type=BESOIN_A_CLARIFIER&historique=1`);
    const corps = await reponse.json();
    expect(corps.attentions.length).toBeGreaterThan(0);
    expect(corps.attentions.every((a: { type: string }) => a.type === "BESOIN_A_CLARIFIER")).toBeTruthy();
  });

  test("un type/priorité/statut invalide dans la query string est ignoré, jamais une erreur 500", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/admin/attentions?type=NIMPORTEQUOI&priorite=INEXISTANT&statut=FAUX");
    expect(reponse.ok()).toBeTruthy();
  });
});
