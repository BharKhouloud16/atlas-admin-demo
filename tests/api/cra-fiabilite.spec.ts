import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

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
