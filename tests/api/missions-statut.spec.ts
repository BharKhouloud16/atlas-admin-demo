import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// Clôture d'une mission par l'Admin (PATCH /api/missions/[id]/statut).
async function missionFictive(suffixe: string) {
  const client = await prisma.client.create({ data: { nom: `Client clôture ${suffixe}` } });
  const profil = await prisma.profil.create({ data: { nom: `Ingé clôture ${suffixe}`, prenom: "Fictif" } });
  return prisma.mission.create({ data: { clientId: client.id, profilId: profil.id, nbJours: 5, tjmVente: 500, repere: `Clôture ${suffixe}` } });
}

test.describe("Missions — clôture par l'Admin", () => {
  test("Admin : En cours → Terminée, tracée ; une seconde clôture est refusée", async () => {
    const mission = await missionFictive(`${Date.now()}-ok`);
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const r = await admin.patch(`/api/missions/${mission.id}/statut`, { data: { statut: "Terminée" } });
    expect(r.status()).toBe(200);
    expect((await r.json()).statut).toBe("Terminée");
    const trace = await prisma.journalActivite.findFirstOrThrow({ where: { action: "cloture_mission", cible: mission.id } });
    expect(trace.detail).toContain("En cours → Terminée");
    expect((await admin.patch(`/api/missions/${mission.id}/statut`, { data: { statut: "Annulée" } })).status()).toBe(409);
  });

  test("statut invalide, mission inconnue, rôles non Admin : refusés sans modification", async () => {
    const mission = await missionFictive(`${Date.now()}-refus`);
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    expect((await admin.patch(`/api/missions/${mission.id}/statut`, { data: { statut: "En cours" } })).status()).toBe(400);
    expect((await admin.patch(`/api/missions/${mission.id}/statut`, { data: {} })).status()).toBe(400);
    expect((await admin.patch(`/api/missions/inexistante-${Date.now()}/statut`, { data: { statut: "Terminée" } })).status()).toBe(404);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    const ingenieur = await contexteConnecte({ email: "ingenieur-demo@example.com", role: "INGENIEUR", profilId: mission.profilId });
    expect((await client.patch(`/api/missions/${mission.id}/statut`, { data: { statut: "Terminée" } })).status()).toBe(403);
    expect((await ingenieur.patch(`/api/missions/${mission.id}/statut`, { data: { statut: "Terminée" } })).status()).toBe(403);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).statut).toBe("En cours");
  });
});
