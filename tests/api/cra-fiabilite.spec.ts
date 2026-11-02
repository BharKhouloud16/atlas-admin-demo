import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { extraireTexteBrutPdf } from "../fixtures/pdf-texte";

// Lot CRA V1 — fiabilité du circuit des feuilles de temps
// (app/api/feuilles-de-temps) : validation des saisies, transitions sous
// concurrence, conflits d'édition, droits d'accès et cohérence avec la
// facture. Mission, ingénieur et client fictifs propres à chaque test.

async function contexteMission(suffixe: string) {
  const client = await prisma.client.create({ data: { nom: `Client CRA ${suffixe}` } });
  const profil = await prisma.profil.create({ data: { nom: `Ingé CRA ${suffixe}`, prenom: "Fictif" } });
  const email = `cra-${suffixe}@example.invalid`;
  await prisma.user.create({ data: { email, passwordHash: "inutilise", role: "INGENIEUR", actif: true, profilId: profil.id } });
  const emailClient = `cra-client-${suffixe}@example.invalid`;
  await prisma.user.create({ data: { email: emailClient, passwordHash: "inutilise", role: "CLIENT", actif: true, clientId: client.id } });
  const mission = await prisma.mission.create({ data: { clientId: client.id, profilId: profil.id, nbJours: 20, tjmVente: 500, repere: `Mission CRA ${suffixe}` } });
  return {
    mission,
    ingenieur: await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id }),
    client: await contexteConnecte({ email: emailClient, role: "CLIENT", clientId: client.id }),
    admin: await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" }),
  };
}

const MOIS = "2026-02";
const jour = (date: string, heures = 8) => ({ date, travaille: true, heures });

test.describe("CRA — validation des saisies", () => {
  test("refuse les saisies incohérentes (400), jamais une erreur serveur", async () => {
    const { mission, ingenieur } = await contexteMission(`${Date.now()}-saisie`);
    const invalides: Record<string, unknown>[] = [
      { joursTravailles: 5, heuresSupplementaires: -10 },
      { joursTravailles: 30 }, // février 2026 : 28 jours
      { detailJours: [jour("2026-03-02")] }, // jour hors du mois déclaré
      { detailJours: [jour("2026-02-02", -8)] },
      { detailJours: [jour("2026-02-02", 30)] },
      { detailJours: [jour("2026-02-02"), jour("2026-02-02")] }, // même jour deux fois
      { detailJours: [{ date: "pas-une-date", travaille: true, heures: 8 }] },
    ];
    const acceptees: string[] = [];
    for (const corps of invalides) {
      const r = await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, ...corps } });
      if (r.status() !== 400) acceptees.push(`${JSON.stringify(corps)} → ${r.status()}`);
      await prisma.feuilleDeTemps.deleteMany({ where: { missionId: mission.id } });
    }
    expect(acceptees).toEqual([]);

    const brut = await ingenieur.fetch("/api/feuilles-de-temps", { method: "POST", headers: { "content-type": "application/json" }, data: "{pas du json" });
    expect(brut.status()).toBe(400);
  });

  test("une saisie valide est enregistrée avec des totaux recalculés côté serveur", async () => {
    const { mission, ingenieur } = await contexteMission(`${Date.now()}-valide`);
    const r = await ingenieur.post("/api/feuilles-de-temps", {
      data: { missionId: mission.id, mois: MOIS, joursTravailles: 99, detailJours: [jour("2026-02-02"), jour("2026-02-03", 10), { date: "2026-02-04", travaille: false, heures: 0 }] },
    });
    expect(r.status()).toBe(201);
    const f = await r.json();
    expect(f.joursTravailles).toBe(2);
    expect(f.heuresSupplementaires).toBe(2);
  });
});

test.describe("CRA — concurrence et conflits d'édition", () => {
  test("deux créations simultanées du même mois : une seule feuille, aucune erreur serveur", async () => {
    const { mission, ingenieur } = await contexteMission(`${Date.now()}-creation`);
    const corps = { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-02")] };
    const statuts = (await Promise.all([1, 2, 3].map(() => ingenieur.post("/api/feuilles-de-temps", { data: corps })))).map((r) => r.status());
    expect(statuts.every((s) => s === 200 || s === 201 || s === 409), statuts.join(",")).toBe(true);
    expect(await prisma.feuilleDeTemps.count({ where: { missionId: mission.id, mois: MOIS } })).toBe(1);
  });

  test("validation et rejet Admin simultanés : une seule transition aboutit", async () => {
    const { mission, ingenieur, admin } = await contexteMission(`${Date.now()}-transition`);
    const f = await (await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-02")], soumettre: true } })).json();
    const [v, rj] = await Promise.all([
      admin.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerAdmin" } }),
      admin.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "rejeter", motifRejet: "Concurrence" } }),
    ]);
    const statuts = [v.status(), rj.status()].sort();
    expect(statuts).toEqual([200, 409]);
    const finale = await prisma.feuilleDeTemps.findUniqueOrThrow({ where: { id: f.id } });
    expect(finale.statut).toBe(v.status() === 200 ? "ValideeAdmin" : "Rejetee");
    if (finale.statut === "ValideeAdmin") expect(finale.motifRejet).toBeNull();
  });

  test("formulaire périmé : un enregistrement fondé sur une version dépassée est refusé (409)", async () => {
    const { mission, ingenieur } = await contexteMission(`${Date.now()}-perime`);
    const v1 = await (await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-02")] } })).json();
    // Onglet A : enregistre une nouvelle version.
    const a = await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-02"), jour("2026-02-03")], versionLue: v1.updatedAt } });
    expect(a.status()).toBe(200);
    // Onglet B, ouvert sur la version 1 : son enregistrement écraserait A.
    const b = await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-05")], versionLue: v1.updatedAt } });
    expect(b.status()).toBe(409);
    expect((await prisma.feuilleDeTemps.findUniqueOrThrow({ where: { id: v1.id } })).joursTravailles).toBe(2);
  });
});

test.describe("CRA — droits d'accès et cohérence avec la facture", () => {
  test("un autre ingénieur, un autre client : aucune lecture ni action sur la feuille", async () => {
    const a = await contexteMission(`${Date.now()}-proprio`);
    const b = await contexteMission(`${Date.now()}-intrus`);
    const f = await (await a.ingenieur.post("/api/feuilles-de-temps", { data: { missionId: a.mission.id, mois: MOIS, detailJours: [jour("2026-02-02")], soumettre: true } })).json();
    await a.admin.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerAdmin" } });

    expect((await b.ingenieur.post("/api/feuilles-de-temps", { data: { missionId: a.mission.id, mois: MOIS, detailJours: [jour("2026-02-03")] } })).status()).toBe(404);
    expect(JSON.stringify(await (await b.ingenieur.get("/api/feuilles-de-temps")).json())).not.toContain(f.id);
    expect(JSON.stringify(await (await b.client.get("/api/feuilles-de-temps")).json())).not.toContain(f.id);
    expect((await b.client.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerClient" } })).status()).toBe(403);
    expect((await a.ingenieur.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerClient" } })).status()).toBe(403);
    expect((await prisma.feuilleDeTemps.findUniqueOrThrow({ where: { id: f.id } })).statut).toBe("ValideeAdmin");
  });

  test("feuille validée par le Client : verrouillée, et la facture reprend exactement ses jours et heures", async () => {
    const { mission, ingenieur, client, admin } = await contexteMission(`${Date.now()}-facture`);
    const f = await (await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-02"), jour("2026-02-03", 12)], soumettre: true } })).json();
    expect((await admin.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerAdmin" } })).status()).toBe(200);
    expect((await client.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerClient" } })).status()).toBe(200);
    expect((await client.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerClient" } })).status()).toBe(409);
    expect((await ingenieur.post("/api/feuilles-de-temps", { data: { missionId: mission.id, mois: MOIS, detailJours: [jour("2026-02-04")] } })).status()).toBe(409);

    const r = await admin.post("/api/factures", { data: { feuilleDeTempsId: f.id } });
    expect([200, 201]).toContain(r.status());
    const facture = await prisma.facture.findUniqueOrThrow({ where: { feuilleDeTempsId: f.id } });
    // 2 jours (8 h + 8 h normales) et 4 h supplémentaires à 500/8 : 1000 + 250.
    expect(Number(facture.montantHT)).toBe(1250);
    const feuille = await prisma.feuilleDeTemps.findUniqueOrThrow({ where: { id: f.id } });
    expect([feuille.joursTravailles, feuille.heuresSupplementaires, feuille.statut]).toEqual([2, 4, "ValideeClient"]);
  });
});

// Feuille validée par l'Admin puis le Client, prête à facturer.
async function feuilleValideeClient(ctx: Awaited<ReturnType<typeof contexteMission>>, mois = MOIS, detail = [jour(`${MOIS}-02`)]) {
  const f = await (await ctx.ingenieur.post("/api/feuilles-de-temps", { data: { missionId: ctx.mission.id, mois, detailJours: detail, soumettre: true } })).json();
  expect((await ctx.admin.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerAdmin" } })).status()).toBe(200);
  expect((await ctx.client.patch("/api/feuilles-de-temps", { data: { id: f.id, action: "validerClient" } })).status()).toBe(200);
  return f as { id: string };
}

test.describe("Facturation — numérotation réglementaire et document unique", () => {
  test("brouillon au numéro provisoire ; numéro FA-{année}-{séquence} attribué à la validation, sans trou ni doublon sous concurrence", async () => {
    const annee = Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()));
    const factures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await contexteMission(`${Date.now()}-num-${i}`);
      const f = await feuilleValideeClient(ctx);
      const { facture } = await (await ctx.admin.post("/api/factures", { data: { feuilleDeTempsId: f.id } })).json();
      expect(facture.numeroFacture).toBe(`BROUILLON-${f.id}`);
      factures.push(facture.id);
    }
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const avant = (await prisma.compteurFacture.findUnique({ where: { annee } }))?.dernier ?? 0;
    // Trois validations simultanées, plus une seconde validation concurrente de la première facture.
    const statuts = (await Promise.all([...factures, factures[0]].map((id) => admin.patch(`/api/factures/${id}/transition`, { data: { action: "valider" } })))).map((r) => r.status());
    expect(statuts.filter((s) => s === 200)).toHaveLength(3);
    expect(statuts.filter((s) => s === 409)).toHaveLength(1);

    const numeros = (await prisma.facture.findMany({ where: { id: { in: factures } } })).map((f) => f.numeroFacture).sort();
    const attendus = [1, 2, 3].map((k) => `FA-${annee}-${String(avant + k).padStart(5, "0")}`);
    // Séquence continue : exactement les 3 numéros suivants du compteur, chacun une fois.
    expect(numeros.filter((n) => attendus.includes(n)).length).toBe(3);
    expect((await prisma.compteurFacture.findUniqueOrThrow({ where: { annee } })).dernier).toBe(avant + 3);
  });

  test("facture numérotée avant la numérotation réglementaire : son numéro est conservé à la validation", async () => {
    const ctx = await contexteMission(`${Date.now()}-ancienne`);
    const f = await feuilleValideeClient(ctx);
    const { facture } = await (await ctx.admin.post("/api/factures", { data: { feuilleDeTempsId: f.id } })).json();
    const ancien = `FA-202602-ANC${Date.now().toString(36).toUpperCase()}`;
    await prisma.facture.update({ where: { id: facture.id }, data: { numeroFacture: ancien } });
    expect((await ctx.admin.patch(`/api/factures/${facture.id}/transition`, { data: { action: "valider" } })).status()).toBe(200);
    expect((await prisma.facture.findUniqueOrThrow({ where: { id: facture.id } })).numeroFacture).toBe(ancien);
  });

  test("PDF du CRA = PDF de la facture enregistrée, avec sa TVA (HT, TVA, TTC)", async () => {
    const ctx = await contexteMission(`${Date.now()}-pdf`);
    const f = await feuilleValideeClient(ctx);
    // Brouillon : aucun PDF émis tant que la facture n'est pas validée.
    const brouillon = await ctx.admin.get(`/api/feuilles-de-temps/facture?feuilleId=${f.id}`);
    expect(brouillon.status()).toBe(409);
    const { factureId } = await brouillon.json();
    // TVA enregistrée sur la facture (1 jour à 500 : 500 HT, 100 TVA, 600 TTC).
    await prisma.facture.update({ where: { id: factureId }, data: { montantHT: 500, montantTVA: 100, montantTTC: 600 } });
    expect((await ctx.admin.patch(`/api/factures/${factureId}/transition`, { data: { action: "valider" } })).status()).toBe(200);
    const { numeroFacture } = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });

    const redirection = await ctx.admin.get(`/api/feuilles-de-temps/facture?feuilleId=${f.id}`, { maxRedirects: 0 });
    expect(redirection.status()).toBe(307);
    expect(redirection.headers()["location"]).toContain(`/api/factures/${factureId}/document`);

    const pdf = await ctx.admin.get(`/api/feuilles-de-temps/facture?feuilleId=${f.id}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const texte = extraireTexteBrutPdf(Buffer.from(await pdf.body()));
    expect(texte).toContain(numeroFacture);
    expect(texte).toContain("Total TTC");
    expect(texte).toContain("600,00");
    expect(texte).not.toContain("TVA non applicable");
  });
});

test.describe("CRA — mission close : saisie bloquée, correction Admin contrôlée et tracée", () => {
  test("l'Ingénieur ne peut plus saisir ni soumettre sur une mission terminée", async () => {
    const ctx = await contexteMission(`${Date.now()}-close`);
    await prisma.mission.update({ where: { id: ctx.mission.id }, data: { statut: "Terminée" } });
    const r = await ctx.ingenieur.post("/api/feuilles-de-temps", { data: { missionId: ctx.mission.id, mois: MOIS, detailJours: [jour("2026-02-02")], soumettre: true } });
    expect(r.status()).toBe(409);
    expect(await prisma.feuilleDeTemps.count({ where: { missionId: ctx.mission.id } })).toBe(0);
  });

  test("correction Admin : motif obligatoire, réservée à l'Admin et aux missions closes, tracée, revalidation Client requise", async () => {
    const ctx = await contexteMission(`${Date.now()}-correction`);
    const corps = { missionId: ctx.mission.id, mois: MOIS, detailJours: [jour("2026-02-02"), jour("2026-02-03")], motif: "Jour oublié signalé par le client" };

    expect((await ctx.admin.post("/api/feuilles-de-temps/correction", { data: corps })).status()).toBe(409); // mission en cours
    await prisma.mission.update({ where: { id: ctx.mission.id }, data: { statut: "Terminée" } });
    expect((await ctx.ingenieur.post("/api/feuilles-de-temps/correction", { data: corps })).status()).toBe(403);
    expect((await ctx.client.post("/api/feuilles-de-temps/correction", { data: corps })).status()).toBe(403);
    expect((await ctx.admin.post("/api/feuilles-de-temps/correction", { data: { ...corps, motif: "court" } })).status()).toBe(400);
    expect((await ctx.admin.post("/api/feuilles-de-temps/correction", { data: { ...corps, detailJours: [jour("2026-03-02")] } })).status()).toBe(400);

    const r = await ctx.admin.post("/api/feuilles-de-temps/correction", { data: corps });
    expect(r.status()).toBe(201);
    const corrigee = await r.json();
    expect([corrigee.statut, corrigee.joursTravailles]).toEqual(["ValideeAdmin", 2]);
    const trace = await prisma.journalActivite.findFirstOrThrow({ where: { action: "correction_cra_mission_close", cible: corrigee.id } });
    expect(trace.acteurEmail).toBe("admin-demo@example.com");
    expect(trace.detail).toContain("aucune feuille → 2 j / 0 h sup (ValideeAdmin)");
    expect(trace.detail).toContain("Motif : Jour oublié signalé par le client");

    // Formulaire périmé : refusé.
    expect((await ctx.admin.post("/api/feuilles-de-temps/correction", { data: { ...corps, versionLue: null } })).status()).toBe(409);
    // Le Client revalide, puis la facture existe : plus aucune correction par le CRA.
    expect((await ctx.client.patch("/api/feuilles-de-temps", { data: { id: corrigee.id, action: "validerClient" } })).status()).toBe(200);
    expect([200, 201]).toContain((await ctx.admin.post("/api/factures", { data: { feuilleDeTempsId: corrigee.id } })).status());
    expect((await ctx.admin.post("/api/feuilles-de-temps/correction", { data: { ...corps, motif: "Seconde correction après facture" } })).status()).toBe(409);
  });
});
