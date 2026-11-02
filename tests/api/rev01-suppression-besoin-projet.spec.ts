import { test, expect, type APIRequestContext } from "@playwright/test";
import { creerClientIsole, connecter } from "../setup/donnees-isolees";
import { prisma } from "@/lib/prisma";

// REV-01 (01/11/2026) — un besoin qui porte un projet, ou une demande en
// cours de traitement, n'est jamais supprimé (ni erreur 500, ni perte de
// données) ; l'archivage d'un besoin de projet actif est refusé.
const SAISIE = { type: "DELIVERY", titre: "Projet REV-01", objectif: "Objectif fictif", resultatAttendu: "Résultat fictif" };

async function projetDe(request: APIRequestContext) {
  const r = await request.post("/api/client/projets", { data: SAISIE });
  expect(r.status(), await r.text()).toBe(201);
  const { id } = await r.json();
  const projet = await prisma.projet.findUniqueOrThrow({ where: { id } });
  return projet;
}

test.describe("REV-01 — suppression d'un besoin rattaché", () => {
  test("besoin d'un projet : suppression refusée (409), projet, besoin et faits intacts", async ({ request }) => {
    const c = await creerClientIsole({ qualification: true });
    await connecter(request, c.email);
    const projet = await projetDe(request);
    const faitsAvant = await prisma.clientNeedFait.count({ where: { needId: projet.needId } });

    const r = await request.delete(`/api/client/besoins/${projet.needId}`);
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toContain("Projet REV-01");

    expect(await prisma.clientNeed.count({ where: { id: projet.needId } })).toBe(1);
    expect(await prisma.clientNeedFait.count({ where: { needId: projet.needId } })).toBe(faitsAvant);
    expect((await prisma.projet.findUniqueOrThrow({ where: { id: projet.id } })).statut).toBe("A_QUALIFIER");

    // La liste des besoins signale le projet porté.
    const liste = await (await request.get("/api/client/besoins")).json();
    const besoin = liste.besoins.find((b: { id: string }) => b.id === projet.needId);
    expect(besoin.projet).toMatchObject({ id: projet.id, titre: "Projet REV-01" });
  });

  test("besoin d'un projet actif : archivage refusé ; autorisé une fois le projet abandonné, suppression toujours refusée", async ({ request }) => {
    const c = await creerClientIsole({ qualification: true });
    await connecter(request, c.email);
    const projet = await projetDe(request);
    expect((await request.patch(`/api/client/besoins/${projet.needId}`, { data: { statut: "ARCHIVE" } })).status()).toBe(409);
    expect((await prisma.clientNeed.findUniqueOrThrow({ where: { id: projet.needId } })).statut).not.toBe("ARCHIVE");

    expect((await request.post(`/api/client/projets/${projet.id}/actions`, { data: { action: "ABANDONNER" } })).status()).toBe(200);
    expect((await request.patch(`/api/client/besoins/${projet.needId}`, { data: { statut: "ARCHIVE" } })).status()).toBe(200);
    expect((await request.delete(`/api/client/besoins/${projet.needId}`)).status()).toBe(409);
    expect(await prisma.projet.count({ where: { id: projet.id } })).toBe(1);
  });

  test("besoin avec une demande en cours à l'équipe ATLAS : suppression refusée ; besoin libre : supprimé", async ({ request }) => {
    const c = await creerClientIsole({ qualification: true });
    await connecter(request, c.email);
    const besoin = await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `rev01-${c.suffixe}`, texteOriginal: "Besoin REV-01", statut: "VALIDE" } });
    const action = await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "AUTRES_PROFILS" } });
    expect(action.status(), await action.text()).toBe(201);
    expect((await request.delete(`/api/client/besoins/${besoin.id}`)).status()).toBe(409);
    expect(await prisma.actionTalentClient.count({ where: { needId: besoin.id } })).toBe(1);

    const libre = await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `rev01-libre-${c.suffixe}`, texteOriginal: "Besoin libre", statut: "SOUMIS" } });
    expect((await request.delete(`/api/client/besoins/${libre.id}`)).status()).toBe(200);
    expect(await prisma.clientNeed.count({ where: { id: libre.id } })).toBe(0);
  });
});
