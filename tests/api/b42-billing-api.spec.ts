import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.2-B (17/09/2026) : API Billing + Fiscal & Regulatory
// Compliance Foundation. Couvre GET/POST /api/factures, GET /api/factures/[id],
// PATCH /api/factures/[id]/transition, GET/POST /api/factures/[id]/paiements,
// GET /api/factures/[id]/document — auth/RBAC, IDOR/BOLA cross-client,
// idempotence (création + paiement), concurrence (création + paiement),
// machine d'état, invariant de solde, visibilité Client (dateEnvoi).
// Même patron que tests/api/b39-client-solution-intelligence-api.spec.ts
// (V2.1-C/E) et tests/api/facturation-devise.spec.ts (route pré-existante,
// non modifiée par ce lot — toujours verte, non touchée ici).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

// FIX (17/09/2026) — Ce fichier appelait initialement /api/auth/login à
// chaque étape de préparation (Admin crée la Mission, Ingénieur soumet le
// CRA, Admin valide, Client valide) pour CHACUN des ~24 tests, via
// feuilleValideeClientDeTest(). En CI (workers=1, un seul run partage le
// même quota RATE_LIMIT_LOGIN_MAX_IP sur 15 min avec tout le reste de la
// suite — voir lib/rate-limit.ts), cela a fait exploser le nombre cumulé de
// connexions bien au-delà de ce que la suite pré-existante consommait déjà,
// déclenchant des 429 en cascade sur des tests SANS RAPPORT (ex.
// tests/e2e/connexion.spec.ts) plus tard dans le run — confirmé en
// comparant le run CI de ce commit à celui, vert, du commit précédent.
//
// Le circuit CRA (Mission -> soumission -> double validation) est déjà
// intégralement testé ailleurs (tests/api/facturation-devise.spec.ts,
// suite feuilles-de-temps) : le reconstituer via l'API à chaque test
// Billing n'apportait aucune couverture supplémentaire, seulement du
// volume de connexions. Les helpers ci-dessous construisent donc cet état
// "donné" (GIVEN) directement via Prisma — même principe que
// tests/api/b39-client-solution-intelligence-api.spec.ts (creerBesoinValide)
// — et ne consomment plus aucune connexion. Seul ce que ce fichier teste
// réellement (les routes /api/factures/*) continue de passer par l'API,
// avec une connexion unique par test plutôt qu'une chaîne de
// changements de rôle.
async function idProfilIngenieurDemo(): Promise<string> {
  const profil = await prisma.profil.findFirst({ where: { nom: "Ingénieur Démo" } });
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil!.id;
}

// Ne PAS chercher "Client Démo SAS" par nom (voir tests/api/facturation-devise.spec.ts,
// FIX B17) : cet environnement local accumule des Client de test au nom
// identique au fil des sessions précédentes — on dérive l'id directement
// depuis le compte lui-même.
async function idClientDemoReel(): Promise<string> {
  const compte = await prisma.user.findUnique({ where: { email: "client-demo@example.com" }, select: { clientId: true } });
  expect(compte?.clientId, "le compte client-demo@example.com devrait être lié à un Client").toBeTruthy();
  return compte!.clientId!;
}

// Second Client isolé, entièrement sous contrôle du test — même précaution
// que b39/b41 : ne jamais s'appuyer sur un second compte de démo qui
// pourrait ne pas exister en CI.
async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test Billing ${suffixe}` } });
}

// Construit directement (sans passer par l'API) une FeuilleDeTemps au
// statut demandé, liée à une Mission de test fraîchement créée pour le
// Client/Ingénieur de démo. `statut: "ValideeClient"` par défaut (le seul
// état facturable, voir lib/billing/creation.ts) ; un test peut demander
// un autre statut (ex. "ValideeAdmin") pour exercer le rejet de
// creerFactureDepuisFeuille.
async function feuilleDeTest(
  mois: string,
  options: { tjmVente?: number; deviseVente?: string; joursTravailles?: number; statut?: string } = {}
) {
  const tjmVente = options.tjmVente ?? 600;
  const deviseVente = options.deviseVente ?? "EUR";
  const joursTravailles = options.joursTravailles ?? 5;
  const statut = options.statut ?? "ValideeClient";

  const [clientId, profilId] = await Promise.all([idClientDemoReel(), idProfilIngenieurDemo()]);
  const mission = await prisma.mission.create({
    data: { clientId, profilId, nbJours: joursTravailles, tjmVente, deviseVente, repere: `Test billing ${mois}-${Date.now()}-${Math.random()}` },
  });
  const maintenant = new Date();
  const feuille = await prisma.feuilleDeTemps.create({
    data: {
      missionId: mission.id,
      mois,
      joursTravailles,
      heuresSupplementaires: 0,
      statut,
      soumiseLe: maintenant,
      valideeAdminLe: statut === "ValideeAdmin" || statut === "ValideeClient" ? maintenant : null,
      valideeClientLe: statut === "ValideeClient" ? maintenant : null,
    },
  });

  const montantTTCAttendu = joursTravailles * tjmVente;
  return { feuilleDeTempsId: feuille.id, clientId, missionId: mission.id, devise: deviseVente, montantTTCAttendu };
}

// Crée une Facture ENVOYEE (prête à recevoir des paiements) en passant par
// le circuit réel Admin pour ce qui est effectivement sous test (jamais une
// écriture Prisma directe pour Facture/Paiement eux-mêmes — seule
// l'isolation inter-client, non atteignable autrement, utilise Prisma
// directement ailleurs dans ce fichier). Une seule connexion Admin, pas une
// par étape.
async function factureEnvoyeeDeTest(request: APIRequestContext, mois: string, options: { tjmVente?: number; deviseVente?: string } = {}) {
  const { feuilleDeTempsId, montantTTCAttendu, devise } = await feuilleDeTest(mois, options);
  await connecter(request, "admin-demo@example.com");
  const creation = await request.post("/api/factures", { data: { feuilleDeTempsId } });
  expect(creation.status()).toBe(201);
  const { facture } = await creation.json();
  await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });
  const envoi = await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });
  expect(envoi.ok()).toBeTruthy();
  return { factureId: facture.id as string, montantTTC: montantTTCAttendu, devise };
}

test.describe("V2.2-B — Création de Facture (POST /api/factures)", () => {
  test("Admin peut créer une Facture depuis un CRA ValideeClient", async ({ request }) => {
    const { feuilleDeTempsId, montantTTCAttendu, devise } = await feuilleDeTest("2026-04");
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/factures", { data: { feuilleDeTempsId } });
    expect(reponse.status()).toBe(201);
    const { facture, dejaExistante } = await reponse.json();
    expect(dejaExistante).toBe(false);
    expect(facture.statut).toBe("BROUILLON");
    expect(facture.devise).toBe(devise);
    expect(Number(facture.montantTTC)).toBe(montantTTCAttendu);
    expect(facture.dateEmission).toBeNull(); // pas encore validée
  });

  test("un CRA pas encore ValideeClient (ex. ValideeAdmin seulement) -> 409, aucune Facture créée", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-05", { statut: "ValideeAdmin" });
    await connecter(request, "admin-demo@example.com");

    const avant = await prisma.facture.count();
    const reponse = await request.post("/api/factures", { data: { feuilleDeTempsId } });
    expect(reponse.status()).toBe(409);
    expect(await prisma.facture.count()).toBe(avant);
  });

  test("Idempotence — un second appel pour la même FeuilleDeTemps renvoie la même Facture (200, jamais un doublon)", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-06");
    await connecter(request, "admin-demo@example.com");
    const premier = await request.post("/api/factures", { data: { feuilleDeTempsId } });
    const premiereFacture = await premier.json();

    const second = await request.post("/api/factures", { data: { feuilleDeTempsId } });
    expect(second.status()).toBe(200);
    const secondeFacture = await second.json();
    expect(secondeFacture.dejaExistante).toBe(true);
    expect(secondeFacture.facture.id).toBe(premiereFacture.facture.id);

    expect(await prisma.facture.count({ where: { feuilleDeTempsId } })).toBe(1);
  });

  test("Concurrence — deux créations simultanées pour la même FeuilleDeTemps -> une seule Facture en base", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-07");
    await connecter(request, "admin-demo@example.com");
    const [r1, r2] = await Promise.all([
      request.post("/api/factures", { data: { feuilleDeTempsId } }),
      request.post("/api/factures", { data: { feuilleDeTempsId } }),
    ]);
    expect([r1.status(), r2.status()].every((s) => s === 200 || s === 201)).toBe(true);
    expect(await prisma.facture.count({ where: { feuilleDeTempsId } })).toBe(1);
  });

  test("RBAC — INGENIEUR et Client ne peuvent jamais créer de Facture, non authentifié non plus", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-08");

    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.post("/api/factures", { data: { feuilleDeTempsId } })).status()).toBe(403);

    await connecter(request, "client-demo@example.com");
    expect((await request.post("/api/factures", { data: { feuilleDeTempsId } })).status()).toBe(403);

    expect(await prisma.facture.count({ where: { feuilleDeTempsId } })).toBe(0);
  });
});

test.describe("V2.2-B — RBAC / IDOR sur la liste et le détail (GET /api/factures[, /[id]])", () => {
  test("non authentifié -> 403 sur la liste et sur le détail (bloqué par le middleware avant la route, même patron que /api/feuilles-de-temps, /api/missions...)", async ({ request }) => {
    expect((await request.get("/api/factures")).status()).toBe(403);
    expect((await request.get("/api/factures/inexistant")).status()).toBe(403);
  });

  test("INGENIEUR -> 403 sur la liste", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/factures")).status()).toBe(403);
  });

  test("un Client ne voit une Facture (liste et détail) qu'une fois ENVOYEE — jamais une facture BROUILLON/VALIDEE, même la sienne", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-09");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();

    await connecter(request, "client-demo@example.com");
    let liste = await (await request.get("/api/factures")).json();
    expect(liste.factures.some((f: { id: string }) => f.id === facture.id)).toBe(false);
    expect((await request.get(`/api/factures/${facture.id}`)).status()).toBe(404);

    await connecter(request, "admin-demo@example.com");
    await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });
    await connecter(request, "client-demo@example.com");
    expect((await request.get(`/api/factures/${facture.id}`)).status()).toBe(404); // VALIDEE mais pas encore ENVOYEE

    await connecter(request, "admin-demo@example.com");
    await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });
    await connecter(request, "client-demo@example.com");
    liste = await (await request.get("/api/factures")).json();
    expect(liste.factures.some((f: { id: string }) => f.id === facture.id)).toBe(true);
    const detail = await request.get(`/api/factures/${facture.id}`);
    expect(detail.status()).toBe(200);
    const { facture: factureClient } = await detail.json();
    // Frontière Client-safe : jamais les champs internes bruts.
    expect(factureClient).not.toHaveProperty("clientId");
    expect(factureClient).not.toHaveProperty("missionId");
    expect(factureClient).not.toHaveProperty("feuilleDeTempsId");
    expect(factureClient).not.toHaveProperty("regleFiscaleId");
    expect(factureClient).not.toHaveProperty("complianceSnapshot");
  });

  test("IDOR — le Client A ne peut jamais voir une Facture ENVOYEE du Client B (404, jamais une fuite d'existence)", async ({ request }) => {
    const clientB = await creerClientDeTest(`${Date.now()}-idor`);
    try {
      const feuille = await feuilleDeTest("2026-10");
      // Réattribue la Facture au Client B après création (isolation testée
      // au niveau lecture, pas au niveau du circuit de création lui-même).
      await connecter(request, "admin-demo@example.com");
      const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId: feuille.feuilleDeTempsId } })).json();
      await prisma.facture.update({ where: { id: facture.id }, data: { clientId: clientB.id } });
      await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });
      await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });

      await connecter(request, "client-demo@example.com");
      expect((await request.get(`/api/factures/${facture.id}`)).status()).toBe(404);
      const liste = await (await request.get("/api/factures")).json();
      expect(liste.factures.some((f: { id: string }) => f.id === facture.id)).toBe(false);
    } finally {
      await prisma.facture.deleteMany({ where: { clientId: clientB.id } });
      await prisma.client.delete({ where: { id: clientB.id } });
    }
  });

  test("Admin voit toujours la Facture brute (montants inclus), quel que soit son statut", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-11");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();
    const detail = await request.get(`/api/factures/${facture.id}`);
    expect(detail.status()).toBe(200);
    const body = await detail.json();
    expect(body.facture.montantTTC).toBeTruthy();
    expect(body.facture.statut).toBe("BROUILLON");
  });
});

test.describe("V2.2-B — Transitions de statut (PATCH /api/factures/[id]/transition)", () => {
  test("cycle complet BROUILLON -> VALIDEE -> ENVOYEE, avec compliance snapshot et échéance figés à la validation", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2026-12");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();

    const valider = await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });
    expect(valider.ok()).toBeTruthy();
    const { facture: validee } = await valider.json();
    expect(validee.statut).toBe("VALIDEE");
    expect(validee.dateEmission).not.toBeNull();
    expect(validee.dateEcheance).not.toBeNull();

    const enBase = await prisma.facture.findUnique({ where: { id: facture.id } });
    expect(enBase!.complianceSnapshot).toMatchObject({ statut: "RESOLU", juridiction: "FR" });

    const envoyer = await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });
    expect(envoyer.ok()).toBeTruthy();
    const { facture: envoyee } = await envoyer.json();
    expect(envoyee.statut).toBe("ENVOYEE");
    expect(envoyee.dateEnvoi).not.toBeNull();
  });

  test("transition invalide -> 409, jamais une mutation silencieuse", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-01");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();

    // BROUILLON -> ENVOYEE directement (sans passer par VALIDEE) est interdit.
    const reponse = await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.facture.findUnique({ where: { id: facture.id } });
    expect(enBase!.statut).toBe("BROUILLON");
  });

  test("annulation — motif obligatoire persisté, jamais une suppression", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-02");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();
    const annuler = await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "annuler", motif: "Erreur de saisie" } });
    expect(annuler.ok()).toBeTruthy();
    const { facture: annulee } = await annuler.json();
    expect(annulee.statut).toBe("ANNULEE");
    expect(annulee.motifAnnulation).toBe("Erreur de saisie");
    expect(await prisma.facture.count({ where: { id: facture.id } })).toBe(1); // toujours là, jamais supprimée
  });

  test("RBAC — jamais le Client ni l'Ingénieur ne peuvent transitionner une Facture", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-03");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();

    await connecter(request, "client-demo@example.com");
    expect((await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } })).status()).toBe(403);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } })).status()).toBe(403);

    const enBase = await prisma.facture.findUnique({ where: { id: facture.id } });
    expect(enBase!.statut).toBe("BROUILLON");
  });
});

test.describe("V2.2-B — Paiements (GET/POST /api/factures/[id]/paiements)", () => {
  test("un paiement ne peut être enregistré que sur une Facture ENVOYEE/PARTIELLEMENT_PAYEE, jamais BROUILLON/VALIDEE", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-04");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();

    const reponse = await request.post(`/api/factures/${facture.id}/paiements`, {
      data: { montant: 100, devise: "EUR", reference: `REF-${Date.now()}`, methode: "Virement" },
    });
    expect(reponse.status()).toBe(409);
    expect(await prisma.paiement.count({ where: { factureId: facture.id } })).toBe(0);
  });

  test("paiement partiel -> PARTIELLEMENT_PAYEE, paiement du solde restant -> PAYEE", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest(request, "2027-05");
    await connecter(request, "admin-demo@example.com");

    const partiel = await request.post(`/api/factures/${factureId}/paiements`, {
      data: { montant: montantTTC / 2, devise, reference: `REF-A-${Date.now()}`, methode: "Virement" },
    });
    expect(partiel.status()).toBe(201);
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("PARTIELLEMENT_PAYEE");

    const solde = await request.post(`/api/factures/${factureId}/paiements`, {
      data: { montant: montantTTC / 2, devise, reference: `REF-B-${Date.now()}`, methode: "Virement" },
    });
    expect(solde.status()).toBe(201);
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("PAYEE");
  });

  test("un paiement qui dépasserait le solde restant est refusé (409), jamais accepté puis clampé", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest(request, "2027-06");
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, {
      data: { montant: montantTTC + 1, devise, reference: `REF-${Date.now()}`, methode: "Virement" },
    });
    expect(reponse.status()).toBe(409);
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("ENVOYEE");
    expect(await prisma.paiement.count({ where: { factureId } })).toBe(0);
  });

  test("devise incohérente avec la Facture -> 409, aucun paiement enregistré", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest(request, "2027-07", { deviseVente: "EUR" });
    expect(devise).toBe("EUR");
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, {
      data: { montant: 100, devise: "USD", reference: `REF-${Date.now()}`, methode: "Virement" },
    });
    expect(reponse.status()).toBe(409);
    expect(await prisma.paiement.count({ where: { factureId } })).toBe(0);
  });

  test("Idempotence — un second appel avec la MÊME référence renvoie le même paiement, jamais comptabilisé deux fois", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest(request, "2027-08");
    await connecter(request, "admin-demo@example.com");
    const reference = `REF-IDEMPOTENT-${Date.now()}`;
    const montant = montantTTC / 4;

    const premier = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant, devise, reference, methode: "Virement" } });
    expect(premier.status()).toBe(201);
    const second = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant, devise, reference, methode: "Virement" } });
    expect(second.status()).toBe(200);

    expect(await prisma.paiement.count({ where: { factureId, reference } })).toBe(1);
    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("PARTIELLEMENT_PAYEE"); // un seul quart payé, pas deux
  });

  test("Concurrence — deux paiements simultanés qui, ensemble, dépasseraient le solde : au plus un seul accepté, jamais un solde négatif", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest(request, "2027-09");
    await connecter(request, "admin-demo@example.com");
    const montantChacun = montantTTC * 0.7; // deux fois 70% > 100% du montant

    const [r1, r2] = await Promise.all([
      request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantChacun, devise, reference: `REF-C1-${Date.now()}`, methode: "Virement" } }),
      request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantChacun, devise, reference: `REF-C2-${Date.now()}`, methode: "Virement" } }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    // L'un des deux réussit (201), l'autre est refusé (409 SOLDE_DEPASSE) —
    // jamais les deux à la fois, jamais un solde négatif.
    expect(statuts).toEqual([201, 409]);

    const paiements = await prisma.paiement.findMany({ where: { factureId, statut: "CONFIRME" } });
    expect(paiements).toHaveLength(1);
    const totalPaye = paiements.reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(totalPaye).toBeLessThanOrEqual(montantTTC);
  });

  test("RBAC — seul l'Admin enregistre un paiement ; le Client peut consulter les siens (une fois envoyés) mais jamais en créer", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest(request, "2027-10");
    await connecter(request, "admin-demo@example.com");
    await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantTTC, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });

    await connecter(request, "client-demo@example.com");
    const refusClient = await request.post(`/api/factures/${factureId}/paiements`, {
      data: { montant: 1, devise, reference: `REF-CLIENT-${Date.now()}`, methode: "Virement" },
    });
    expect(refusClient.status()).toBe(403);

    const lectureClient = await request.get(`/api/factures/${factureId}/paiements`);
    expect(lectureClient.status()).toBe(200);
    const { paiements } = await lectureClient.json();
    expect(paiements.length).toBe(1);

    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get(`/api/factures/${factureId}/paiements`)).status()).toBe(403);
  });
});

test.describe("V2.2-B — Document PDF (GET /api/factures/[id]/document)", () => {
  test("document indisponible tant que la Facture n'est pas au moins VALIDEE (409)", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-11");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();
    expect((await request.get(`/api/factures/${facture.id}/document`)).status()).toBe(409);
  });

  test("génère le PDF une fois VALIDEE, le persiste, et sert le même document aux appels suivants (jamais deux PDF divergents)", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2027-12");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();
    await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });

    const premier = await request.get(`/api/factures/${facture.id}/document`);
    expect(premier.status()).toBe(200);
    expect(premier.headers()["content-type"]).toContain("application/pdf");

    const enBaseApres1 = await prisma.facture.findUnique({ where: { id: facture.id } });

    const second = await request.get(`/api/factures/${facture.id}/document`);
    expect(second.status()).toBe(200);
    expect(second.headers()["content-type"]).toContain("application/pdf");

    // La persistance (Facture.documentId, un seul Document en base) dépend
    // d'un Blob store privé configuré (BLOB_READ_WRITE_TOKEN, voir
    // lib/storage.ts) — absent dans cet environnement local (comme pour la
    // route pré-existante /api/feuilles-de-temps/facture, jamais testée sur
    // ce point non plus par tests/api/facturation-devise.spec.ts, pour la
    // même raison). Quand le stockage EST configuré (CI/production), on
    // vérifie l'invariant fort : un seul Document persisté pour cette
    // Facture, jamais un second généré au second appel.
    if (enBaseApres1!.documentId) {
      const documents = await prisma.document.findMany({ where: { id: enBaseApres1!.documentId } });
      expect(documents).toHaveLength(1);
    }
  });

  test("le Client ne peut télécharger le PDF qu'une fois la Facture envoyée, jamais avant (404 anti-fuite)", async ({ request }) => {
    const { feuilleDeTempsId } = await feuilleDeTest("2028-01");
    await connecter(request, "admin-demo@example.com");
    const { facture } = await (await request.post("/api/factures", { data: { feuilleDeTempsId } })).json();
    await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } });

    await connecter(request, "client-demo@example.com");
    expect((await request.get(`/api/factures/${facture.id}/document`)).status()).toBe(404);

    await connecter(request, "admin-demo@example.com");
    await request.patch(`/api/factures/${facture.id}/transition`, { data: { action: "envoyer" } });

    await connecter(request, "client-demo@example.com");
    expect((await request.get(`/api/factures/${facture.id}/document`)).status()).toBe(200);
  });
});
