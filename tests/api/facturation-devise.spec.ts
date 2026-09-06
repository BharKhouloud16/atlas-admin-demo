import zlib from "zlib";
import { test, expect, APIRequestContext } from "@playwright/test";

// pdf-lib compresse les flux de contenu (FlateDecode) : chercher le code
// devise directement dans les octets bruts du PDF ne fonctionne pas — il
// faut décompresser chaque flux "stream...endstream" pour retrouver le
// texte réellement dessiné (opérateurs Tj/TJ). Pas de nouvelle dépendance :
// zlib est un module Node natif.
function extraireTexteBrutPdf(pdfBytes: Buffer): string {
  const contenu = pdfBytes.toString("latin1");
  const morceaux: string[] = [];
  const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(contenu))) {
    try {
      morceaux.push(zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      // pas un flux FlateDecode (ex. police déjà binaire) — ignoré
    }
  }
  return morceaux.join("\n");
}

// Couvre P1-01 (audit du 06/09) : la facture doit refléter la devise réelle
// de la mission (Mission.deviseVente) plutôt que d'être toujours libellée
// EUR. Un seul scénario de bout en bout par devise (EUR/USD/GBP), rejouant
// le circuit réel Mission -> CRA -> double validation -> Facture PDF, sans
// jamais convertir le montant — seul le code devise doit changer.
//
// `request` (APIRequestContext) conserve un cookie de session entre les
// appels : on "change d'acteur" en se reconnectant successivement avec un
// autre compte de démo (admin-demo / ingenieur-demo / client-demo, tous en
// Demo1234 — voir prisma/seed.ts), comme le permet le fait que chaque appel
// n'a besoin que de la session la plus récente.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/profils");
  expect(reponse.ok()).toBeTruthy();
  // GET /api/profils renvoie { profils, nombreDesactives }, pas un tableau
  // brut (voir app/api/profils/route.ts).
  const { profils } = await reponse.json();
  // Deux profils existent dans le seed ("Ingénieur Démo" et "Nouvel
  // Ingénieur (test)", en attente) — on prend explicitement le premier par
  // son nom plutôt que le premier de la liste (triée par date de création
  // décroissante, donc pas dans un ordre garanti stable).
  const profil = profils.find((p: { nom: string }) => p.nom === "Ingénieur Démo");
  expect(profil, "le profil de démo 'Ingénieur Démo' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return profil.id;
}

async function idPremierClient(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/clients");
  expect(reponse.ok()).toBeTruthy();
  const clients = await reponse.json();
  expect(clients.length).toBeGreaterThan(0);
  return clients[0].id;
}

// Fait avancer une mission jusqu'à la facture disponible et renvoie les
// octets du PDF généré.
async function factureDeMissionTest(request: APIRequestContext, mois: string, tjmVente: number, deviseVente: string) {
  await connecter(request, "admin-demo@example.com");
  const clientId = await idPremierClient(request);
  const profilId = await idProfilIngenieurDemo(request);

  const creation = await request.post("/api/missions", {
    data: { clientId, profilId, nbJours: 5, tjmVente, deviseVente, repere: `Test devise ${deviseVente}` },
  });
  expect(creation.status(), "création de la mission de test").toBe(201);
  const mission = await creation.json();
  expect(mission.deviseVente).toBe(deviseVente);

  await connecter(request, "ingenieur-demo@example.com");
  const soumission = await request.post("/api/feuilles-de-temps", {
    data: { missionId: mission.id, mois, joursTravailles: 5, heuresSupplementaires: 0, soumettre: true },
  });
  expect(soumission.status(), "soumission du CRA").toBe(201);
  const feuille = await soumission.json();

  await connecter(request, "admin-demo@example.com");
  const validationAdmin = await request.patch("/api/feuilles-de-temps", {
    data: { id: feuille.id, action: "validerAdmin" },
  });
  expect(validationAdmin.ok(), "validation Admin du CRA").toBeTruthy();

  await connecter(request, "client-demo@example.com");
  const validationClient = await request.patch("/api/feuilles-de-temps", {
    data: { id: feuille.id, action: "validerClient" },
  });
  expect(validationClient.ok(), "validation Client du CRA").toBeTruthy();

  await connecter(request, "admin-demo@example.com");
  const facture = await request.get(`/api/feuilles-de-temps/facture?feuilleId=${feuille.id}`);
  expect(facture.status(), "génération de la facture PDF").toBe(200);
  expect(facture.headers()["content-type"]).toContain("application/pdf");
  return Buffer.from(await facture.body());
}

test.describe("Facturation — devise réelle de la mission (P1-01)", () => {
  test("mission EUR -> facture en EUR", async ({ request }) => {
    const pdf = await factureDeMissionTest(request, "2026-01", 600, "EUR");
    expect(extraireTexteBrutPdf(pdf)).toContain("EUR");
  });

  test("mission USD -> facture en USD (pas de conversion)", async ({ request }) => {
    const pdf = await factureDeMissionTest(request, "2026-02", 650, "USD");
    expect(extraireTexteBrutPdf(pdf)).toContain("USD");
  });

  test("mission GBP -> facture en GBP (pas de conversion)", async ({ request }) => {
    const pdf = await factureDeMissionTest(request, "2026-03", 550, "GBP");
    expect(extraireTexteBrutPdf(pdf)).toContain("GBP");
  });
});
