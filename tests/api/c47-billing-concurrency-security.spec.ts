import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.2-C (17/09/2026) : Billing — Facturation opérationnelle.
//
// Mandat CEO V2.2-C section 21 exige explicitement des tests de concurrence
// sur la validation et l'émission de Facture, en plus de ceux déjà écrits
// en V2.2-B pour la création et le paiement (voir
// tests/api/b42-billing-api.spec.ts). L'audit de ce lot a trouvé que
// lib/billing/transitions.ts (validerFacture/envoyerFacture/annulerFacture)
// lisait puis écrivait la Facture en deux opérations séparées, sans garde
// entre les deux — un vrai trou de concurrence, corrigé dans ce même lot
// (écriture conditionnelle via updateMany, voir lib/billing/transitions.ts).
// Ce fichier vérifie le correctif, plus la génération documentaire
// concurrente (app/api/factures/[id]/document/route.ts, même correctif) et
// les vérifications IDOR/BOLA supplémentaires demandées section 20
// ("Client A -> Paiement Client B = 404") qui manquaient à V2.2-B.
//
// Même discipline anti-volume-de-connexions que b42-billing-api.spec.ts
// (voir son commentaire d'en-tête, FIX 17/09/2026) : l'état "donné" est
// construit directement via Prisma, jamais via une chaîne de connexions/
// changements de rôle pour rejouer le circuit CRA déjà testé ailleurs.

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
  return prisma.client.create({ data: { nom: `Client Test Concurrence ${suffixe}` } });
}

// Construit directement (sans API) une Facture au statut demandé, avec sa
// Mission/FeuilleDeTemps sous-jacentes — même principe que
// tests/api/b42-billing-api.spec.ts (feuilleDeTest), poussé jusqu'à
// Facture pour ces tests qui exercent spécifiquement les transitions et le
// document, jamais la création elle-même (déjà couverte ailleurs).
async function factureDeTest(mois: string, statut: "BROUILLON" | "VALIDEE" = "BROUILLON") {
  const [clientId, profilId] = await Promise.all([idClientDemoReel(), idProfilIngenieurDemo()]);
  const tjmVente = 600;
  const joursTravailles = 5;
  const mission = await prisma.mission.create({
    data: { clientId, profilId, nbJours: joursTravailles, tjmVente, deviseVente: "EUR", repere: `Test concurrence ${mois}-${Date.now()}-${Math.random()}` },
  });
  const maintenant = new Date();
  const feuille = await prisma.feuilleDeTemps.create({
    data: {
      missionId: mission.id,
      mois,
      joursTravailles,
      heuresSupplementaires: 0,
      statut: "ValideeClient",
      soumiseLe: maintenant,
      valideeAdminLe: maintenant,
      valideeClientLe: maintenant,
    },
  });
  const montantTTC = joursTravailles * tjmVente;
  const facture = await prisma.facture.create({
    data: {
      clientId,
      missionId: mission.id,
      feuilleDeTempsId: feuille.id,
      numeroFacture: `FA-TESTCONC-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      statut: "BROUILLON",
      montantHT: montantTTC,
      montantTVA: 0,
      montantTTC,
      devise: "EUR",
    },
  });
  if (statut === "VALIDEE") {
    const dateEcheance = new Date(maintenant);
    dateEcheance.setDate(dateEcheance.getDate() + 30);
    await prisma.facture.update({ where: { id: facture.id }, data: { statut: "VALIDEE", dateEmission: maintenant, dateEcheance } });
  }
  return { factureId: facture.id, clientId, montantTTC };
}

test.describe("V2.2-C — Concurrence sur les transitions de statut (mandat CEO section 21)", () => {
  test("deux validations simultanées de la même Facture BROUILLON -> une seule réussit, l'autre est refusée (409), jamais les deux", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-02", "BROUILLON");
    await connecter(request, "admin-demo@example.com");

    const [r1, r2] = await Promise.all([
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } }),
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("VALIDEE");
    expect(enBase!.dateEmission).not.toBeNull();
  });

  test("deux émissions simultanées de la même Facture VALIDEE -> une seule réussit, l'autre est refusée (409)", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-03", "VALIDEE");
    await connecter(request, "admin-demo@example.com");

    const [r1, r2] = await Promise.all([
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "envoyer" } }),
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "envoyer" } }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(enBase!.statut).toBe("ENVOYEE");
    expect(enBase!.dateEnvoi).not.toBeNull();
  });

  test("émission et annulation simultanées depuis VALIDEE -> jamais un état corrompu, même quand les deux réussissent légitimement", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-04", "VALIDEE");
    await connecter(request, "admin-demo@example.com");

    // Note de conception : contrairement aux tests précédents (même action
    // répétée), "envoyer" et "annuler" ne sont PAS mutuellement exclusifs au
    // niveau métier — ANNULEE est atteignable aussi bien depuis VALIDEE que
    // depuis ENVOYEE (voir lib/billing/etat-facture.ts : "une facture
    // partiellement payée peut encore être annulée, ex. litige" — le même
    // principe s'applique à ENVOYEE). Si les deux requêtes s'exécutent
    // véritablement en même temps, la garde CAS de ecrireTransition()
    // n'autorise qu'UNE seule écriture à partir du statut VALIDEE observé
    // par CHAQUE requête à sa propre lecture (409 pour l'autre) ; si elles
    // s'exécutent en réalité l'une après l'autre (pas de vraie course), la
    // seconde relit le statut déjà à jour et peut légitimement réussir une
    // annulation d'une facture déjà ENVOYEE. Les deux issues sont donc
    // valides ([200,409] ou [200,200]) — ce qui ne l'est JAMAIS, c'est un
    // état final incohérent (ex. ENVOYEE avec un motif d'annulation, ou
    // ANNULEE sans motif).
    const [envoi, annulation] = await Promise.all([
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "envoyer" } }),
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "annuler", motif: "Test concurrence" } }),
    ]);
    const statuts = [envoi.status(), annulation.status()].sort();
    expect([JSON.stringify([200, 200]), JSON.stringify([200, 409])]).toContain(JSON.stringify(statuts));

    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    expect(["ENVOYEE", "ANNULEE"]).toContain(enBase!.statut);
    if (enBase!.statut === "ENVOYEE") {
      // L'annulation a été refusée (409) — l'émission reste seule vraie.
      expect(annulation.status()).toBe(409);
      expect(enBase!.motifAnnulation).toBeNull();
      expect(enBase!.dateEnvoi).not.toBeNull();
    } else {
      // ANNULEE — qu'elle vienne directement de VALIDEE (émission perdante,
      // dateEnvoi jamais posé) ou d'ENVOYEE (émission gagnante puis
      // annulée ensuite, dateEnvoi posé) : dans les deux cas le motif est
      // obligatoirement renseigné, jamais un état ANNULEE muet.
      expect(enBase!.motifAnnulation).toBe("Test concurrence");
      if (envoi.status() === 200) {
        expect(enBase!.dateEnvoi).not.toBeNull();
      } else {
        expect(enBase!.dateEnvoi).toBeNull();
      }
    }
  });

  test("trois tentatives de validation en rafale sur la même Facture -> exactement une seule Facture VALIDEE, jamais un double comptage d'échéance", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-05", "BROUILLON");
    await connecter(request, "admin-demo@example.com");

    const reponses = await Promise.all([
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } }),
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } }),
      request.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } }),
    ]);
    const succes = reponses.filter((r) => r.status() === 200);
    const echecs = reponses.filter((r) => r.status() === 409);
    expect(succes).toHaveLength(1);
    expect(echecs).toHaveLength(2);
  });
});

test.describe("V2.2-C — Concurrence sur la génération documentaire (mandat CEO section 21)", () => {
  test("deux générations simultanées du document -> un seul Document persisté et lié, jamais deux PDF divergents", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-06", "VALIDEE");
    await connecter(request, "admin-demo@example.com");

    const [d1, d2] = await Promise.all([request.get(`/api/factures/${factureId}/document`), request.get(`/api/factures/${factureId}/document`)]);
    expect(d1.status()).toBe(200);
    expect(d2.status()).toBe(200);
    expect(d1.headers()["content-type"]).toContain("application/pdf");
    expect(d2.headers()["content-type"]).toContain("application/pdf");

    // La déduplication (un seul Document lié) dépend d'un Blob store privé
    // configuré (BLOB_READ_WRITE_TOKEN, voir lib/storage.ts) — absent en
    // local (même limite déjà documentée dans
    // tests/api/b42-billing-api.spec.ts). Quand il EST configuré, on
    // vérifie l'invariant fort de ce correctif V2.2-C.
    const enBase = await prisma.facture.findUnique({ where: { id: factureId } });
    if (enBase!.documentId) {
      const documentsLies = await prisma.document.count({ where: { id: enBase!.documentId } });
      expect(documentsLies).toBe(1);
      const tousLesDocumentsDeLaFacture = await prisma.document.count({
        where: { missionId: (await prisma.facture.findUnique({ where: { id: factureId }, select: { missionId: true } }))!.missionId },
      });
      // Un seul Document créé pour cette Mission de test dédiée (créée
      // fraîchement par factureDeTest, jamais partagée avec un autre
      // test) — la course perdante a bien été nettoyée, pas seulement
      // délaissée.
      expect(tousLesDocumentsDeLaFacture).toBe(1);
    }
  });
});

test.describe("V2.2-C — Sécurité complémentaire (mandat CEO section 20)", () => {
  test("IDOR — le Client A ne peut jamais lister les paiements d'une Facture ENVOYEE du Client B (404)", async ({ request }) => {
    const clientB = await creerClientDeTest(`${Date.now()}-paiements`);
    try {
      const { factureId } = await factureDeTest("2028-07", "VALIDEE");
      await prisma.facture.update({ where: { id: factureId }, data: { clientId: clientB.id } });
      await connecter(request, "admin-demo@example.com");
      const envoi = await request.patch(`/api/factures/${factureId}/transition`, { data: { action: "envoyer" } });
      expect(envoi.ok()).toBeTruthy();
      await request.post(`/api/factures/${factureId}/paiements`, {
        data: { montant: 100, devise: "EUR", reference: `REF-${Date.now()}`, methode: "Virement" },
      });

      await connecter(request, "client-demo@example.com");
      const lecture = await request.get(`/api/factures/${factureId}/paiements`);
      expect(lecture.status()).toBe(404);
    } finally {
      await prisma.paiement.deleteMany({ where: { facture: { clientId: clientB.id } } });
      await prisma.facture.deleteMany({ where: { clientId: clientB.id } });
      await prisma.client.delete({ where: { id: clientB.id } });
    }
  });

  test("IDOR — le Client A ne peut jamais télécharger le document d'une Facture ENVOYEE du Client B (404)", async ({ request }) => {
    const clientB = await creerClientDeTest(`${Date.now()}-document`);
    try {
      const { factureId } = await factureDeTest("2028-08", "VALIDEE");
      await prisma.facture.update({ where: { id: factureId }, data: { clientId: clientB.id } });
      await connecter(request, "admin-demo@example.com");
      const envoi = await request.patch(`/api/factures/${factureId}/transition`, { data: { action: "envoyer" } });
      expect(envoi.ok()).toBeTruthy();

      await connecter(request, "client-demo@example.com");
      const document = await request.get(`/api/factures/${factureId}/document`);
      expect(document.status()).toBe(404);
    } finally {
      await prisma.facture.deleteMany({ where: { clientId: clientB.id } });
      await prisma.client.delete({ where: { id: clientB.id } });
    }
  });

  test("un Ingénieur n'a jamais accès aux paiements ni au document d'une Facture, quelle qu'elle soit", async ({ request }) => {
    const { factureId } = await factureDeTest("2028-09", "VALIDEE");
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get(`/api/factures/${factureId}/paiements`)).status()).toBe(403);
    expect((await request.get(`/api/factures/${factureId}/document`)).status()).toBe(403);
  });
});
