import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.2-D (17/09/2026) : Billing — Paiements + Solde +
// Rapprochement.
//
// Audit (mandat CEO V2.2-D section 1) : le modèle Paiement, le calcul de
// solde, l'idempotence et la concurrence de création de paiement étaient
// déjà entièrement couverts par tests/api/b42-billing-api.spec.ts et
// tests/api/c47-billing-concurrency-security.spec.ts (V2.2-B/C) — non
// reconstruits ici. Ce fichier couvre UNIQUEMENT le delta réel de V2.2-D :
// annulerPaiement() (transition CONFIRME -> ANNULE jamais atteinte avant ce
// lot), les frontières monétaires explicitement demandées (section 21), le
// scénario de paiements concurrents complémentaires qui, ensemble, soldent
// exactement la Facture (section 9, distinct du scénario "dépassement"
// déjà testé en V2.2-C), et les invariants financiers formalisés section 20.
//
// Même discipline anti-volume-de-connexions que les fichiers V2.2-B/C/D
// précédents : état "donné" construit directement via Prisma, une seule
// connexion par test pour ce qui est effectivement sous test.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idProfilIngenieurDemo(): Promise<string> {
  const profil = await prisma.profil.findFirst({ where: { nom: "Ingénieur Démo" } });
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil!.id;
}

async function idClientDemoReel(): Promise<string> {
  const compte = await prisma.user.findUnique({ where: { email: "client-demo@example.com" }, select: { clientId: true } });
  expect(compte?.clientId, "le compte client-demo@example.com devrait être lié à un Client").toBeTruthy();
  return compte!.clientId!;
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test Paiements ${suffixe}` } });
}

// Construit directement une Facture ENVOYEE, prête à recevoir des
// paiements, avec un montantTTC exact contrôlé par le test (pour les
// scénarios de frontière) — même principe que
// tests/api/c47-billing-concurrency-security.spec.ts (factureDeTest).
async function factureEnvoyeeDeTest(mois: string, montantTTC: number, devise = "EUR") {
  const [clientId, profilId] = await Promise.all([idClientDemoReel(), idProfilIngenieurDemo()]);
  // tjmVente/joursTravailles arbitraires (1 jour, TJM = montantTTC) —
  // seul le montantTTC final compte pour ces tests.
  const mission = await prisma.mission.create({
    data: { clientId, profilId, nbJours: 1, tjmVente: montantTTC, deviseVente: devise, repere: `Test paiements ${mois}-${Date.now()}-${Math.random()}` },
  });
  const maintenant = new Date();
  const feuille = await prisma.feuilleDeTemps.create({
    data: {
      missionId: mission.id,
      mois,
      joursTravailles: 1,
      heuresSupplementaires: 0,
      statut: "ValideeClient",
      soumiseLe: maintenant,
      valideeAdminLe: maintenant,
      valideeClientLe: maintenant,
    },
  });
  const dateEcheance = new Date(maintenant);
  dateEcheance.setDate(dateEcheance.getDate() + 30);
  const facture = await prisma.facture.create({
    data: {
      clientId,
      missionId: mission.id,
      feuilleDeTempsId: feuille.id,
      numeroFacture: `FA-TESTPAY-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      statut: "ENVOYEE",
      montantHT: montantTTC,
      montantTVA: 0,
      montantTTC,
      devise,
      dateEmission: maintenant,
      dateEcheance,
      dateEnvoi: maintenant,
    },
  });
  return { factureId: facture.id, clientId, montantTTC, devise };
}

test.describe("V2.2-D — Annulation de paiement (delta réel : ANNULE jamais atteint avant ce lot)", () => {
  test("annuler l'unique paiement (100% du montantTTC) d'une Facture PAYEE la ramène à ENVOYEE, solde entier restauré", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2029-01", 1000);
    await connecter(request, "admin-demo@example.com");

    const paiement = await (
      await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantTTC, devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("PAYEE");

    const annulation = await request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} });
    expect(annulation.ok()).toBeTruthy();

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    // Solde redevenu égal au montantTTC entier (aucun paiement CONFIRME
    // restant) -> ENVOYEE, jamais PARTIELLEMENT_PAYEE (réservé à
    // 0 < payé < TTC, voir lib/billing/etat-facture.ts statutDepuisSolde()).
    expect(enBase!.statut).toBe("ENVOYEE");
    const paiementEnBase = await prisma.paiement.findUnique({ where: { id: paiement.paiement.id } });
    expect(paiementEnBase!.statut).toBe("ANNULE");
    expect(paiementEnBase!.montant.toNumber()).toBe(montantTTC); // jamais supprimé ni modifié, seulement son statut
  });

  test("annuler un paiement partiel ramène la Facture de PARTIELLEMENT_PAYEE à ENVOYEE si c'était le seul paiement", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2029-02", 1000);
    await connecter(request, "admin-demo@example.com");

    const paiement = await (
      await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 400, devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("PARTIELLEMENT_PAYEE");

    await request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} });

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("ENVOYEE");
  });

  test("annuler un paiement sur une Facture déjà ANNULEE ne la fait jamais redevenir ENVOYEE/PARTIELLEMENT_PAYEE/PAYEE", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2029-03", 1000);
    await connecter(request, "admin-demo@example.com");

    const paiement = await (
      await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 400, devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();
    await request.patch(`/api/factures/${factureId}/transition`, { data: { action: "annuler", motif: "Litige" } });
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("ANNULEE");

    const annulationPaiement = await request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} });
    expect(annulationPaiement.ok()).toBeTruthy();

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("ANNULEE"); // jamais repositionné — état terminal respecté
    expect((await prisma.paiement.findUnique({ where: { id: paiement.paiement.id } }))!.statut).toBe("ANNULE");
  });

  test("Idempotence — annuler deux fois le même paiement ne le recompte jamais deux fois dans le solde", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2029-04", 1000);
    await connecter(request, "admin-demo@example.com");

    const paiement = await (
      await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 400, devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();

    const premiere = await request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} });
    expect(premiere.ok()).toBeTruthy();
    const seconde = await request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} });
    expect(seconde.ok()).toBeTruthy();

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("ENVOYEE"); // pas de double annulation qui déraillerait le calcul
  });

  test("Concurrence — deux annulations simultanées du même paiement ne corrompent jamais le solde", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2029-05", 1000);
    await connecter(request, "admin-demo@example.com");

    const paiement = await (
      await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 600, devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();

    const [r1, r2] = await Promise.all([
      request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} }),
      request.patch(`/api/factures/${factureId}/paiements/${paiement.paiement.id}`, { data: {} }),
    ]);
    expect(r1.ok()).toBeTruthy();
    expect(r2.ok()).toBeTruthy();

    // Invariant clé : même si les deux requêtes réussissent (l'annulation
    // est idempotente, jamais une erreur), le paiement n'est jamais compté
    // deux fois en moins — la Facture reste ENVOYEE, pas un solde
    // supérieur au montantTTC (ce qu'impliquerait un double-décompte).
    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("ENVOYEE");
  });

  test("RBAC — jamais le Client ni l'Ingénieur ne peuvent annuler un paiement", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2029-06", 1000);
    const paiement = await prisma.paiement.create({
      data: { factureId, montant: 400, devise, datePaiement: new Date(), reference: `REF-${Date.now()}`, methode: "Virement", statut: "CONFIRME" },
    });

    await connecter(request, "client-demo@example.com");
    expect((await request.patch(`/api/factures/${factureId}/paiements/${paiement.id}`, { data: {} })).status()).toBe(403);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.patch(`/api/factures/${factureId}/paiements/${paiement.id}`, { data: {} })).status()).toBe(403);

    expect((await prisma.paiement.findUnique({ where: { id: paiement.id } }))!.statut).toBe("CONFIRME");
  });

  test("un paiement inexistant, ou n'appartenant pas à la Facture désignée dans l'URL, -> 404", async ({ request }) => {
    const factureA = await factureEnvoyeeDeTest("2029-07", 1000);
    const factureB = await factureEnvoyeeDeTest("2029-08", 1000);
    await connecter(request, "admin-demo@example.com");
    const paiementA = await (
      await request.post(`/api/factures/${factureA.factureId}/paiements`, { data: { montant: 400, devise: factureA.devise, reference: `REF-${Date.now()}`, methode: "Virement" } })
    ).json();

    expect((await request.patch(`/api/factures/${factureB.factureId}/paiements/${paiementA.paiement.id}`, { data: {} })).status()).toBe(404);
    expect((await request.patch(`/api/factures/${factureA.factureId}/paiements/inexistant`, { data: {} })).status()).toBe(404);
  });
});

test.describe("V2.2-D — Frontières monétaires (mandat CEO section 21)", () => {
  test("paiement exact du montantTTC -> PAYEE, solde = 0", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2029-09", 1000);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantTTC, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(201);
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("PAYEE");
  });

  test("paiement de montantTTC - 0.01 -> PARTIELLEMENT_PAYEE, solde = 0.01 exactement", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2029-10", 1000);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantTTC - 0.01, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(201);
    const enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    expect(enBase!.statut).toBe("PARTIELLEMENT_PAYEE");
    const paye = enBase!.paiements.reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(Number((enBase!.montantTTC.toNumber() - paye).toFixed(2))).toBe(0.01);
  });

  test("paiement de montantTTC + 0.01 -> refusé (409), jamais accepté puis clampé", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2029-11", 1000);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: montantTTC + 0.01, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(409);
    expect((await prisma.facture.findUnique({ where: { id: factureId } }))!.statut).toBe("ENVOYEE");
  });

  test("paiement de 0.01 (plus petit montant valide) -> accepté, solde décrémenté exactement", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2029-12", 1000);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 0.01, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(201);
    const enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    const paye = enBase!.paiements.reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(Number((montantTTC - paye).toFixed(2))).toBe(999.99);
  });

  test("paiement de 0 -> refusé (montant invalide), jamais enregistré", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2030-01", 1000);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 0, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(409);
    expect(await prisma.paiement.count({ where: { factureId } })).toBe(0);
  });

  test("montants non ronds (10.005, 1000000.99) — jamais de dérive flottante sur le solde stocké", async ({ request }) => {
    const { factureId, montantTTC, devise } = await factureEnvoyeeDeTest("2030-02", 1000000.99);
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 10.01, devise, reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(201);
    const enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    const paye = enBase!.paiements.reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(Number((montantTTC - paye).toFixed(2))).toBe(999990.98);
  });
});

test.describe("V2.2-D — Concurrence : paiements complémentaires (mandat CEO section 9)", () => {
  test("deux paiements concurrents dont la somme égale exactement le montantTTC -> tous deux acceptés, PAYEE, solde = 0 (jamais 1000+400 ni un rejet)", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2030-03", 1000);
    await connecter(request, "admin-demo@example.com");

    const [a, b] = await Promise.all([
      request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 600, devise, reference: `REF-A-${Date.now()}`, methode: "Virement" } }),
      request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 400, devise, reference: `REF-B-${Date.now()}`, methode: "Virement" } }),
    ]);
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(201);

    const enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    expect(enBase!.statut).toBe("PAYEE");
    const totalPaye = enBase!.paiements.filter((p) => p.statut === "CONFIRME").reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(totalPaye).toBe(1000); // jamais 1400, jamais 600 seul
    expect(enBase!.paiements).toHaveLength(2);
  });
});

test.describe("V2.2-D — Invariants financiers formalisés (mandat CEO section 20)", () => {
  test("devise du paiement != devise de la Facture -> toujours refusé, jamais une conversion implicite", async ({ request }) => {
    const { factureId } = await factureEnvoyeeDeTest("2030-04", 1000, "EUR");
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 500, devise: "USD", reference: `REF-${Date.now()}`, methode: "Virement" } });
    expect(reponse.status()).toBe(409);
  });

  test("PAYEE <-> solde = 0 : vrai dans les deux sens, y compris après une annulation partielle qui repasse sous TTC", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2030-05", 1000);
    await connecter(request, "admin-demo@example.com");
    const p1 = await (await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 1000, devise, reference: `REF-A-${Date.now()}`, methode: "Virement" } })).json();
    let enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    expect(enBase!.statut).toBe("PAYEE");
    const solde1 = enBase!.montantTTC.toNumber() - enBase!.paiements.filter((p) => p.statut === "CONFIRME").reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(solde1).toBe(0);

    await request.patch(`/api/factures/${factureId}/paiements/${p1.paiement.id}`, { data: {} });
    enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    expect(enBase!.statut).not.toBe("PAYEE");
    const solde2 = enBase!.montantTTC.toNumber() - enBase!.paiements.filter((p) => p.statut === "CONFIRME").reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(solde2).not.toBe(0);
  });

  test("aucun paiement ANNULE n'est jamais compté dans le total payé, quel que soit le nombre de paiements", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2030-06", 1000);
    await connecter(request, "admin-demo@example.com");
    const p1 = await (await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 300, devise, reference: `REF-A-${Date.now()}`, methode: "Virement" } })).json();
    await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 200, devise, reference: `REF-B-${Date.now()}`, methode: "Virement" } });
    await request.patch(`/api/factures/${factureId}/paiements/${p1.paiement.id}`, { data: {} });

    const enBase = await prisma.facture.findUnique({ where: { id: factureId }, include: { paiements: true } });
    const totalConfirme = enBase!.paiements.filter((p) => p.statut === "CONFIRME").reduce((s, p) => s + p.montant.toNumber(), 0);
    expect(totalConfirme).toBe(200); // les 300 annulés n'y figurent jamais
    expect(enBase!.paiements).toHaveLength(2); // historique complet conservé, rien supprimé
  });

  test("historique immuable — un paiement annulé reste lisible avec son montant/référence d'origine intacts", async ({ request }) => {
    const { factureId, devise } = await factureEnvoyeeDeTest("2030-07", 1000);
    await connecter(request, "admin-demo@example.com");
    const reference = `REF-IMMUABLE-${Date.now()}`;
    const p1 = await (await request.post(`/api/factures/${factureId}/paiements`, { data: { montant: 250, devise, reference, methode: "Chèque" } })).json();
    await request.patch(`/api/factures/${factureId}/paiements/${p1.paiement.id}`, { data: {} });

    const paiementEnBase = await prisma.paiement.findUnique({ where: { id: p1.paiement.id } });
    expect(paiementEnBase!.montant.toNumber()).toBe(250);
    expect(paiementEnBase!.reference).toBe(reference);
    expect(paiementEnBase!.methode).toBe("Chèque");
    expect(paiementEnBase!.statut).toBe("ANNULE"); // seul champ changé
  });
});

test.describe("V2.2-D — Sécurité (mandat CEO section 19)", () => {
  test("IDOR — le Client A ne peut jamais annuler un paiement d'une Facture du Client B (403, RBAC avant ownership)", async ({ request }) => {
    const clientB = await creerClientDeTest(`${Date.now()}-annulation`);
    try {
      const { factureId, devise } = await factureEnvoyeeDeTest("2030-08", 1000);
      await prisma.facture.update({ where: { id: factureId }, data: { clientId: clientB.id } });
      const paiement = await prisma.paiement.create({
        data: { factureId, montant: 400, devise, datePaiement: new Date(), reference: `REF-${Date.now()}`, methode: "Virement", statut: "CONFIRME" },
      });

      await connecter(request, "client-demo@example.com");
      const reponse = await request.patch(`/api/factures/${factureId}/paiements/${paiement.id}`, { data: {} });
      expect(reponse.status()).toBe(403);
    } finally {
      await prisma.paiement.deleteMany({ where: { facture: { clientId: clientB.id } } });
      await prisma.facture.deleteMany({ where: { clientId: clientB.id } });
      await prisma.client.delete({ where: { id: clientB.id } });
    }
  });
});
