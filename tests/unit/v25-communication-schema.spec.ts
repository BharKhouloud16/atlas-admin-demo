import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 (21/09/2026) : tests SCHÉMA UNIQUEMENT pour
// MessageLecture, PreferenceNotification et AttentionType.MESSAGE_NON_LU
// (Lot 0). Ce fichier n'exerce AUCUN comportement applicatif : aucune
// route, aucune synchronisation Attention, aucun email. Vérifie
// uniquement que le schéma additif, la contrainte @@unique([clientId,
// userId]) de MessageLecture, l'unicité par User de PreferenceNotification
// et la nouvelle valeur d'enum se comportent comme conçu.
//
// Entités FRAÎCHES à chaque test (jamais les comptes de démo partagés) :
// MessageLecture/PreferenceNotification portent des contraintes uniques
// sur des clés étrangères réelles (clientId/userId), qui ne peuvent pas
// être rendues uniques par un simple suffixe comme pour un champ texte —
// réutiliser un compte de démo entre tests ferait collisionner la
// contrainte elle-même et casserait l'isolation des tests.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerClientDeTest() {
  return prisma.client.create({ data: { nom: `Client V2.5 Test ${suffixe()}` } });
}

async function creerUserAdmin() {
  return prisma.user.create({
    data: { email: `admin-v25-${suffixe()}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
  });
}

async function creerUserPourClient(clientId: string) {
  return prisma.user.create({
    data: { email: `client-v25-${suffixe()}@test.local`, passwordHash: "hash-de-test", role: "CLIENT", clientId },
  });
}

test.describe("COMPANY ATLAS V2.5 Lot 0 — MessageLecture / PreferenceNotification (schéma uniquement)", () => {
  test("Test 1 — un curseur MessageLecture peut être créé pour (client, user), dernierLuLe par défaut", async () => {
    const client = await creerClientDeTest();
    const admin = await creerUserAdmin();

    const curseur = await prisma.messageLecture.create({
      data: { clientId: client.id, userId: admin.id },
    });

    expect(curseur.clientId).toBe(client.id);
    expect(curseur.userId).toBe(admin.id);
    expect(curseur.dernierLuLe).toBeTruthy();
  });

  test("Test 2 — un même (clientId, userId) est unique : une seconde création échoue (contrainte @@unique)", async () => {
    const client = await creerClientDeTest();
    const admin = await creerUserAdmin();
    await prisma.messageLecture.create({ data: { clientId: client.id, userId: admin.id } });

    let aEchoue = false;
    try {
      await prisma.messageLecture.create({ data: { clientId: client.id, userId: admin.id } });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "un doublon (clientId, userId) doit être rejeté par la contrainte unique").toBe(true);
  });

  test("Test 3 — lecture Admin individuelle : deux curseurs distincts pour deux User différents sur le même client (jamais un curseur partagé par rôle)", async () => {
    const client = await creerClientDeTest();
    const adminA = await creerUserAdmin();
    const adminB = await creerUserAdmin();

    const curseurA = await prisma.messageLecture.create({ data: { clientId: client.id, userId: adminA.id } });
    const curseurB = await prisma.messageLecture.create({ data: { clientId: client.id, userId: adminB.id } });

    expect(curseurA.id).not.toBe(curseurB.id);
    expect(curseurA.userId).toBe(adminA.id);
    expect(curseurB.userId).toBe(adminB.id);

    const tousLesCurseurs = await prisma.messageLecture.findMany({ where: { clientId: client.id } });
    expect(tousLesCurseurs.length).toBe(2);
  });

  test("Test 4 — userId doit référencer un User existant (contrainte FK, jamais un curseur orphelin)", async () => {
    const client = await creerClientDeTest();
    let aEchoue = false;
    try {
      await prisma.messageLecture.create({ data: { clientId: client.id, userId: "user-inexistant-jamais-cree" } });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue).toBe(true);
  });

  test("Test 5 — une PreferenceNotification peut être créée pour un User, emailActif=true par défaut", async () => {
    const admin = await creerUserAdmin();
    const preference = await prisma.preferenceNotification.create({
      data: { userId: admin.id, categoriesEmail: ["ACTION_REQUISE", "ALERTE"] },
    });

    expect(preference.userId).toBe(admin.id);
    expect(preference.emailActif).toBe(true);
    expect(preference.categoriesEmail.sort()).toEqual(["ACTION_REQUISE", "ALERTE"].sort());
  });

  test("Test 6 — PreferenceNotification est unique par User (@@unique userId) : une seconde ligne pour le même User échoue", async () => {
    const admin = await creerUserAdmin();
    await prisma.preferenceNotification.create({ data: { userId: admin.id, categoriesEmail: [] } });

    let aEchoue = false;
    try {
      await prisma.preferenceNotification.create({ data: { userId: admin.id, categoriesEmail: [] } });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "une seconde PreferenceNotification pour le même userId doit être rejetée").toBe(true);
  });

  test("Test 7 — AttentionType.MESSAGE_NON_LU est utilisable, catégorie ACTION_REQUISE, source='Message'", async () => {
    const client = await creerClientDeTest();
    const attention = await prisma.attention.create({
      data: {
        type: "MESSAGE_NON_LU",
        categorie: "ACTION_REQUISE",
        priorite: "P2_NORMALE",
        titre: "Vous avez des messages non lus",
        resume: "Un ou plusieurs messages n'ont pas encore été lus.",
        raison: "Un message a été envoyé sur ce fil depuis la dernière lecture.",
        source: "Message",
        sourceId: client.id,
        recipientType: "CLIENT",
        recipientId: client.id,
      },
    });

    expect(attention.type).toBe("MESSAGE_NON_LU");
    expect(attention.source).toBe("Message");
    expect(attention.sourceId).toBe(client.id);
  });

  test("Test 8 — idempotence structurelle héritée d'Attention : (type, source, sourceId) reste unique pour MESSAGE_NON_LU aussi", async () => {
    const client = await creerClientDeTest();
    await prisma.attention.create({
      data: {
        type: "MESSAGE_NON_LU",
        categorie: "ACTION_REQUISE",
        priorite: "P2_NORMALE",
        titre: "t1",
        resume: "r1",
        raison: "raison1",
        source: "Message",
        sourceId: client.id,
        recipientType: "CLIENT",
        recipientId: client.id,
      },
    });

    let aEchoue = false;
    try {
      await prisma.attention.create({
        data: {
          type: "MESSAGE_NON_LU",
          categorie: "ACTION_REQUISE",
          priorite: "P2_NORMALE",
          titre: "t2",
          resume: "r2",
          raison: "raison2",
          source: "Message",
          sourceId: client.id,
          recipientType: "CLIENT",
          recipientId: client.id,
        },
      });
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "(type, source, sourceId) identiques doivent être rejetés par la contrainte héritée d'Attention").toBe(true);
  });

  test("Test 9 — isolation : les curseurs d'un client n'apparaissent jamais dans le filtrage par clientId d'un autre client", async () => {
    const clientA = await creerClientDeTest();
    const clientB = await creerClientDeTest();
    const admin = await creerUserAdmin();

    await prisma.messageLecture.create({ data: { clientId: clientA.id, userId: admin.id } });

    const curseursDeB = await prisma.messageLecture.findMany({ where: { clientId: clientB.id } });
    expect(curseursDeB.length).toBe(0);
  });

  test("Test 10 — un même User (compte Client, User.clientId unique) peut avoir son propre curseur sur son propre fil", async () => {
    const client = await creerClientDeTest();
    const userClient = await creerUserPourClient(client.id);

    const curseur = await prisma.messageLecture.create({ data: { clientId: client.id, userId: userClient.id } });
    expect(curseur.userId).toBe(userClient.id);
    expect(curseur.clientId).toBe(client.id);
  });
});
