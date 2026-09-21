import { test, expect, APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 2 — Message →
// Attention, 21/09/2026).
//
// Couvre le câblage Message -> MESSAGE_NON_LU via le moteur de
// synchronisation Attention EXISTANT (lib/attention/synchronisation.ts,
// construireEntitesMessage) : agrégation par thread, idempotence,
// résolution automatique à la lecture effective, individualité Admin
// (règle #7 — jamais un signal partagé par rôle), IDOR/BOLA sur les routes
// Admin existantes désormais individuelles.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function userIdDemo(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeTruthy();
  return user!.id;
}

async function messageNonLu(clientId: string, sourceId: string) {
  return prisma.attention.findUnique({ where: { type_source_sourceId: { type: "MESSAGE_NON_LU", source: "Message", sourceId } } });
}

// Client + compte connectable FRAIS, jamais le compte de démo partagé —
// les tests "résolution automatique" côté Client manipulent le curseur
// MessageLecture d'un Client en parallèle d'autres tests ; réutiliser
// client-demo@example.com ferait courir plusieurs tests sur le même
// curseur (contamination croisée entre workers), même piège documenté
// dans tests/unit/v25-communication-schema.spec.ts pour les contraintes
// uniques — jamais atteignable avec un Client fraîchement créé par test.
async function creerClientConnecte(suffixe: string) {
  const client = await prisma.client.create({ data: { nom: `Client Lot2 Frais ${suffixe}` } });
  const email = `client-lot2-${suffixe}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email };
}

test.describe("V2.5 Lot 2 — Message envoyé -> MESSAGE_NON_LU pour le destinataire, agrégé par thread", () => {
  test("un message Client crée une Attention ADMIN individuelle pour l'Admin démo, visible dans sa liste", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 A ${Date.now()}` } });
    const userAdmin = await userIdDemo("admin-demo@example.com");

    await connecter(request, "admin-demo@example.com");
    // Précondition : ce client n'a pas encore de compte, on écrit le message
    // Client directement en base (contourne la contrainte de session Client
    // réelle, jamais atteignable pour un client sans compte).
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Bonjour" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`); // déclenche synchroniserAttentionsGlobal

    const attention = await messageNonLu(client.id, `${client.id}:${userAdmin}`);
    expect(attention).toBeTruthy();
    expect(attention!.recipientType).toBe("ADMIN");
    expect(attention!.recipientId).toBe(userAdmin);
    expect(attention!.statut).toBe("OUVERTE");
    expect(attention!.categorie).toBe("ACTION_REQUISE");

    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    expect(corps.attentions.some((a: { type: string }) => a.type === "MESSAGE_NON_LU")).toBe(true);
  });

  test("POST /api/clients/[id]/messages déclenche immédiatement la synchronisation (jamais besoin d'un second GET)", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 Immediat ${Date.now()}` } });
    await connecter(request, "admin-demo@example.com");

    // Le message ADMIN cible le Client — mais aucun compte Client n'existe
    // ici, donc c'est le côté ADMIN qu'on vérifie via un message inverse :
    // on écrit un message CLIENT en base puis on poste un message ADMIN
    // (qui doit déclencher la resynchronisation du thread entier).
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Premier message" } });
    const post = await request.post(`/api/clients/${client.id}/messages`, { data: { contenu: "Réponse admin" } });
    expect(post.status()).toBe(201);

    const userAdmin = await userIdDemo("admin-demo@example.com");
    const attention = await messageNonLu(client.id, `${client.id}:${userAdmin}`);
    expect(attention, "la synchronisation doit avoir tourné dès le POST, sans GET intermédiaire").toBeTruthy();
  });

  test("idempotence : plusieurs messages Client non lus n'accumulent jamais plusieurs MESSAGE_NON_LU pour le même Admin", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 Idempotence ${Date.now()}` } });
    await connecter(request, "admin-demo@example.com");

    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "1" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "2" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "3" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    const userAdmin = await userIdDemo("admin-demo@example.com");
    const lignes = await prisma.attention.findMany({ where: { type: "MESSAGE_NON_LU", source: "Message", sourceId: `${client.id}:${userAdmin}` } });
    expect(lignes).toHaveLength(1);
  });
});

test.describe("V2.5 Lot 2 — Résolution automatique à la lecture effective (règle #11)", () => {
  test("marquer le fil lu (Admin) résout sa propre MESSAGE_NON_LU, jamais celle d'un autre Admin", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 Resolution ${Date.now()}` } });
    const secondAdmin = await prisma.user.create({
      data: { email: `admin-lot2-second-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });

    await connecter(request, "admin-demo@example.com");
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Message initial" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`); // sync : ouvre les deux MESSAGE_NON_LU (premier + second Admin)

    const userPremierAdmin = await userIdDemo("admin-demo@example.com");
    const avantPremier = await messageNonLu(client.id, `${client.id}:${userPremierAdmin}`);
    const avantSecond = await messageNonLu(client.id, `${client.id}:${secondAdmin.id}`);
    expect(avantPremier!.statut).toBe("OUVERTE");
    expect(avantSecond!.statut).toBe("OUVERTE");

    const lu = await request.post(`/api/clients/${client.id}/messages/lu`);
    expect(lu.ok()).toBeTruthy();

    const apresPremier = await messageNonLu(client.id, `${client.id}:${userPremierAdmin}`);
    const apresSecond = await messageNonLu(client.id, `${client.id}:${secondAdmin.id}`);
    expect(apresPremier!.statut).toBe("RESOLUE"); // lecture effective du premier Admin
    expect(apresSecond!.statut).toBe("OUVERTE"); // jamais touchée : le second Admin n'a rien lu
  });

  test("marquer le fil lu (Client) résout la MESSAGE_NON_LU CLIENT, source=Message sourceId=clientId", async ({ request }) => {
    const { client, email } = await creerClientConnecte(`resolution-${Date.now()}`);

    await connecter(request, "admin-demo@example.com");
    await request.post(`/api/clients/${client.id}/messages`, { data: { contenu: "Réponse admin non lue" } });

    const avant = await messageNonLu(client.id, client.id);
    expect(avant).toBeTruthy();
    expect(avant!.statut).toBe("OUVERTE");
    expect(avant!.recipientType).toBe("CLIENT");

    await connecter(request, email);
    const lu = await request.post("/api/client/messages/lu");
    expect(lu.ok()).toBeTruthy();

    const apres = await messageNonLu(client.id, client.id);
    expect(apres!.statut).toBe("RESOLUE");
  });

  test("un nouveau message après résolution rouvre MESSAGE_NON_LU (jamais figée RESOLUE)", async ({ request }) => {
    const { client, email } = await creerClientConnecte(`reouverture-${Date.now()}`);
    await connecter(request, email);
    await request.post("/api/client/messages/lu"); // curseur à jour, rien à lire

    await connecter(request, "admin-demo@example.com");
    await request.post(`/api/clients/${client.id}/messages`, { data: { contenu: "Nouveau message après lecture" } });

    const attention = await messageNonLu(client.id, client.id);
    expect(attention!.statut).toBe("OUVERTE");
  });
});

test.describe("V2.5 Lot 2 — IDOR/BOLA : individualité Admin sur les routes existantes", () => {
  test("PATCH /api/admin/attentions/[id] sur la MESSAGE_NON_LU d'un autre Admin -> 404 (jamais 403)", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 IDOR PATCH ${Date.now()}` } });
    const secondAdmin = await prisma.user.create({
      data: { email: `admin-lot2-idor-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });

    await connecter(request, "admin-demo@example.com");
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    const attentionSecondAdmin = await messageNonLu(client.id, `${client.id}:${secondAdmin.id}`);
    expect(attentionSecondAdmin).toBeTruthy();

    const reponse = await request.patch(`/api/admin/attentions/${attentionSecondAdmin!.id}`, { data: { action: "lire" } });
    expect(reponse.status()).toBe(404);

    const enBase = await prisma.attention.findUnique({ where: { id: attentionSecondAdmin!.id } });
    expect(enBase!.statut).toBe("OUVERTE"); // jamais modifiée par la tentative refusée
  });

  test("GET /api/admin/attentions ne renvoie jamais la MESSAGE_NON_LU individuelle d'un autre Admin", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 IDOR GET ${Date.now()}` } });
    const secondAdmin = await prisma.user.create({
      data: { email: `admin-lot2-idor-get-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });

    await connecter(request, "admin-demo@example.com");
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    const attentionSecondAdmin = await messageNonLu(client.id, `${client.id}:${secondAdmin.id}`);
    expect(attentionSecondAdmin).toBeTruthy();

    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    expect(corps.attentions.some((a: { id: string }) => a.id === attentionSecondAdmin!.id)).toBe(false);
  });

  test("tout-lire Admin ne marque jamais lue la MESSAGE_NON_LU individuelle d'un autre Admin", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 ToutLire ${Date.now()}` } });
    const secondAdmin = await prisma.user.create({
      data: { email: `admin-lot2-toutlire-${Date.now()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
    });

    await connecter(request, "admin-demo@example.com");
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });
    await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);

    await request.post("/api/admin/attentions/tout-lire");

    const attentionSecondAdmin = await messageNonLu(client.id, `${client.id}:${secondAdmin.id}`);
    expect(attentionSecondAdmin!.statut).toBe("OUVERTE"); // jamais touchée par le tout-lire du premier Admin

    const userPremierAdmin = await userIdDemo("admin-demo@example.com");
    const attentionPremierAdmin = await messageNonLu(client.id, `${client.id}:${userPremierAdmin}`);
    expect(attentionPremierAdmin!.statut).toBe("LUE"); // bien marquée lue pour l'Admin qui a appelé tout-lire
  });

  test("ANOMALIE_FINANCIERE (recipientId=null) reste partagée entre Admins, jamais restreinte par le filtre d'individualité", async ({ request }) => {
    const client = await prisma.client.create({ data: { nom: `Client Lot2 Anomalie Partagee ${Date.now()}` } });
    const profil = await prisma.profil.findFirst({ where: { nom: "Ingénieur Démo" } });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil!.id, nbJours: 1, tjmVente: 1000, deviseVente: "EUR", repere: `Lot2 anomalie ${Date.now()}` },
    });
    const feuille = await prisma.feuilleDeTemps.create({
      data: { missionId: mission.id, mois: "2029-01", joursTravailles: 1, heuresSupplementaires: 0, statut: "ValideeClient", soumiseLe: new Date(), valideeAdminLe: new Date(), valideeClientLe: new Date() },
    });
    const facture = await prisma.facture.create({
      data: {
        clientId: client.id,
        missionId: mission.id,
        feuilleDeTempsId: feuille.id,
        numeroFacture: `FA-LOT2-${Date.now()}`,
        statut: "ENVOYEE",
        montantHT: 1000,
        montantTVA: 0,
        montantTTC: -1,
        devise: "EUR",
        dateEmission: new Date(),
        dateEcheance: new Date(Date.now() - 24 * 60 * 60 * 1000),
        dateEnvoi: new Date(),
      },
    });

    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/admin/attentions?clientId=${client.id}&historique=1`);
    const corps = await reponse.json();
    expect(corps.attentions.some((a: { type: string; sourceId: string }) => a.type === "ANOMALIE_FINANCIERE" && a.sourceId === facture.id)).toBe(true);
  });
});
