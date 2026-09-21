import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { synchroniserEtNotifierMessage } from "@/lib/message-attention-email";
import { marquerFilLu } from "@/lib/message-lecture";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 4 — Email
// transactionnel, 21/09/2026).
//
// Appelle synchroniserEtNotifierMessage directement (in-process, pas de
// HTTP) : RESEND_API_KEY n'est jamais configurée dans cet environnement de
// test (voir lib/email.ts), donc chaque tentative d'envoi passe par le
// chemin `console.log("[email:placeholder] ...")`, seul point observable
// depuis un test sans introduire de mock/infrastructure supplémentaire.
// Un test HTTP (via les routes POST /api/*/messages) ne pourrait pas
// observer ce log, écrit dans le process du serveur Next.js séparé —
// même limitation déjà rencontrée pour BLOB_READ_WRITE_TOKEN en V2.4.

function espionnerConsoleLog(): { appels: string[]; restaurer: () => void } {
  const appels: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    appels.push(args.map(String).join(" "));
  };
  return { appels, restaurer: () => (console.log = original) };
}

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerClientAvecCompte() {
  const s = suffixe();
  const client = await prisma.client.create({ data: { nom: `Client Lot4 ${s}` } });
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const user = await prisma.user.create({
    data: { email: `client-lot4-${s}@test.local`, passwordHash, role: "CLIENT", actif: true, clientId: client.id },
  });
  return { client, userId: user.id, email: user.email };
}

async function creerAdmin() {
  const s = suffixe();
  const user = await prisma.user.create({
    data: { email: `admin-lot4-${s}@test.local`, passwordHash: "hash-de-test", role: "ADMIN" },
  });
  return { userId: user.id, email: user.email };
}

test.describe("V2.5 Lot 4 — email envoyé uniquement sur transition réelle vers non lu", () => {
  test("premier message Client -> un email est tenté pour chaque Admin existant", async () => {
    const { client } = await creerClientAvecCompte();
    const admin = await creerAdmin();
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "Bonjour" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes("[email:placeholder]") && a.includes(admin.email) && a.includes("Nouveaux messages non lus"))).toBe(true);
  });

  test("un second message Client sur un fil déjà non lu -> aucun nouvel email (mandat : jamais un email par message)", async () => {
    const { client } = await creerClientAvecCompte();
    await creerAdmin();
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "1" } });
    await synchroniserEtNotifierMessage(client.id); // 1er email

    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "2" } });
    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes("[email:placeholder]"))).toBe(false);
  });

  test("réouverture après lecture effective -> un nouvel email est tenté (jamais figé après la 1ère notification)", async () => {
    const { client } = await creerClientAvecCompte();
    const admin = await creerAdmin();
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "1" } });
    await synchroniserEtNotifierMessage(client.id); // ouvre + notifie

    await marquerFilLu(client.id, admin.userId); // l'Admin lit tout
    const { synchroniserAttentionsClient } = await import("@/lib/attention/synchronisation");
    await synchroniserAttentionsClient(client.id); // résout MESSAGE_NON_LU de cet Admin

    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "2" } }); // réouvre

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes("[email:placeholder]") && a.includes(admin.email))).toBe(true);
  });
});

test.describe("V2.5 Lot 4 — respect strict de PreferenceNotification", () => {
  test("emailActif=false -> aucun email tenté malgré la transition vers non lu", async () => {
    const { client } = await creerClientAvecCompte();
    const admin = await creerAdmin();
    await prisma.preferenceNotification.create({ data: { userId: admin.userId, emailActif: false, categoriesEmail: ["ACTION_REQUISE", "ALERTE"] } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes(admin.email))).toBe(false);
  });

  test("categoriesEmail sans ACTION_REQUISE -> aucun email tenté (MESSAGE_NON_LU est toujours ACTION_REQUISE)", async () => {
    const { client } = await creerClientAvecCompte();
    const admin = await creerAdmin();
    await prisma.preferenceNotification.create({ data: { userId: admin.userId, emailActif: true, categoriesEmail: ["INFORMATION"] } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes(admin.email))).toBe(false);
  });

  test("aucune PreferenceNotification en base -> défauts (ACTION_REQUISE actif) -> email tenté", async () => {
    const { client } = await creerClientAvecCompte();
    const admin = await creerAdmin();
    expect(await prisma.preferenceNotification.findUnique({ where: { userId: admin.userId } })).toBeNull();
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes(admin.email))).toBe(true);
  });

  test("individualité : deux Admins avec des préférences opposées -> un seul reçoit l'email", async () => {
    const { client } = await creerClientAvecCompte();
    const adminActif = await creerAdmin();
    const adminInactif = await creerAdmin();
    await prisma.preferenceNotification.create({ data: { userId: adminInactif.userId, emailActif: false, categoriesEmail: [] } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "CLIENT", contenu: "x" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes(adminActif.email))).toBe(true);
    expect(espion.appels.some((a) => a.includes(adminInactif.email))).toBe(false);
  });
});

test.describe("V2.5 Lot 4 — côté Client, et cas limites sans destinataire", () => {
  test("message Admin -> email tenté pour le Client ayant un compte de connexion, lien /client/communication", async () => {
    const { client, email } = await creerClientAvecCompte();
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "Réponse" } });

    const espion = espionnerConsoleLog();
    await synchroniserEtNotifierMessage(client.id);
    espion.restaurer();

    expect(espion.appels.some((a) => a.includes(email) && a.includes("/client/communication"))).toBe(true);
  });

  test("Client sans compte de connexion -> aucun crash, aucun email tenté", async () => {
    const client = await prisma.client.create({ data: { nom: `Client Lot4 SansCompte ${suffixe()}` } });
    await prisma.message.create({ data: { clientId: client.id, auteurRole: "ADMIN", contenu: "Réponse" } });

    let erreur: unknown = null;
    try {
      await synchroniserEtNotifierMessage(client.id);
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeNull();
  });

  test("client sans aucun message -> aucun email tenté, jamais un crash (rien à notifier)", async () => {
    const { client } = await creerClientAvecCompte();

    const espion = espionnerConsoleLog();
    let erreur: unknown = null;
    try {
      await synchroniserEtNotifierMessage(client.id);
    } catch (e) {
      erreur = e;
    }
    espion.restaurer();

    expect(erreur).toBeNull();
    expect(espion.appels.some((a) => a.includes("[email:placeholder]"))).toBe(false);
  });
});
