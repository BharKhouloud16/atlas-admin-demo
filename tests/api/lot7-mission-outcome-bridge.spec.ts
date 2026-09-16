import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — LOT 7 : Mission Outcome → Client Profile Bridge (16/09/2026).
// Couvre l'extension de GET /api/client/profil (signalResultatMission) et le
// chemin de confirmation explicite via POST /api/client/profil/faits
// (AJOUTER + depuisSignal, route INCHANGÉE depuis LOT 4). Isolation client,
// jamais d'écriture automatique, anti-doublon, missions non évaluées
// ignorées. Le comportement exact de detecterSignalResultatMission (seuils,
// moyenne, texte) est couvert par tests/unit/mission-outcome-signal.spec.ts
// — ici on vérifie uniquement le câblage HTTP/sécurité.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function lireProfil(request: APIRequestContext) {
  const reponse = await request.get("/api/client/profil");
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
  return reponse.json();
}

async function creerProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Ingénieur Test LOT7 ${suffixe}` } });
}

async function creerMissionEvaluee(clientId: string, profilId: string, note: number) {
  const mission = await prisma.mission.create({
    data: { clientId, profilId, nbJours: 5, tjmVente: 500, statut: "Terminée" },
  });
  await prisma.evaluation.create({ data: { missionId: mission.id, note } });
  return mission;
}

test.describe("COMPANY ATLAS LOT 7 — Mission Outcome → Client Profile Bridge (API)", () => {
  test.describe("GET /api/client/profil — signalResultatMission", () => {
    test("apparaît une fois le seuil atteint (>=2 missions évaluées, moyenne >=4), missions cibles incluses", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const m1 = await creerMissionEvaluee(client!.id, profil.id, 5);
      const m2 = await creerMissionEvaluee(client!.id, profil.id, 5);

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      expect(data.signalResultatMission).not.toBeNull();
      expect(data.signalResultatMission.cle).toBe("CRITERE_REUSSITE_DURABLE");
      expect(data.signalResultatMission.missionIds).toEqual(expect.arrayContaining([m1.id, m2.id]));
      expect(data.signalResultatMission.noteMoyenne).toBeGreaterThanOrEqual(4);
    });

    test("les missions sans Evaluation ne sont jamais comptées dans le signal", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      const nonEvaluee = await prisma.mission.create({ data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 500 } });

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      const idsDuSignal: string[] = data.signalResultatMission?.missionIds ?? [];
      expect(idsDuSignal).not.toContain(nonEvaluee.id);
    });

    test("jamais écrit automatiquement en ClientProfileFact — le simple GET ne crée aucune ligne", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      await creerMissionEvaluee(client!.id, profil.id, 5);
      await creerMissionEvaluee(client!.id, profil.id, 5);

      const avant = await prisma.clientProfileFact.count({ where: { cle: "CRITERE_REUSSITE_DURABLE", source: "client_confirmation_signal" } });

      await connecter(request, "client-demo@example.com");
      await lireProfil(request);
      await lireProfil(request);
      await lireProfil(request);

      const apres = await prisma.clientProfileFact.count({ where: { cle: "CRITERE_REUSSITE_DURABLE", source: "client_confirmation_signal" } });
      expect(apres).toBe(avant); // aucune écriture déclenchée par la lecture seule
    });

    test("isolation : les missions évaluées d'un autre client n'apparaissent jamais dans le signal du client courant", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const creationClient = await request.post("/api/clients", { data: { nom: `Client LOT7 Isolation ${Date.now()}` } });
      const autreClient = await creationClient.json();
      const profil = await creerProfil();
      const foreign1 = await creerMissionEvaluee(autreClient.id, profil.id, 5);
      const foreign2 = await creerMissionEvaluee(autreClient.id, profil.id, 5);

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      const idsDuSignal: string[] = data.signalResultatMission?.missionIds ?? [];
      expect(idsDuSignal).not.toContain(foreign1.id);
      expect(idsDuSignal).not.toContain(foreign2.id);
    });

    test("non authentifié / mauvais rôle -> 403 (régression, comportement inchangé par LOT 7)", async ({ request }) => {
      const sansSession = await request.get("/api/client/profil");
      expect(sansSession.status()).toBe(403);

      await connecter(request, "admin-demo@example.com");
      const commeAdmin = await request.get("/api/client/profil");
      expect(commeAdmin.status()).toBe(403);
    });
  });

  test.describe("POST /api/client/profil/faits — confirmation explicite du signal (AJOUTER + depuisSignal)", () => {
    test("confirmer un signal crée un fait statut DECLARE, source client_confirmation_signal", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      await creerMissionEvaluee(client!.id, profil.id, 5);
      await creerMissionEvaluee(client!.id, profil.id, 5);

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      const signal = data.signalResultatMission;
      expect(signal).not.toBeNull();

      const confirmation = await request.post("/api/client/profil/faits", {
        data: { cle: signal.cle, action: "AJOUTER", valeur: signal.valeur, depuisSignal: true },
      });
      expect(confirmation.status(), await confirmation.text()).toBe(201);
      const { fait } = await confirmation.json();
      expect(fait.statut).toBe("DECLARE");
      expect(fait.source).toBe("client_confirmation_signal");
      expect(fait.valeur).toBe(signal.valeur);
    });

    test("anti-doublon : confirmer deux fois le même signal (même valeur normalisée) est refusé (409)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      await creerMissionEvaluee(client!.id, profil.id, 5);
      await creerMissionEvaluee(client!.id, profil.id, 5);

      await connecter(request, "client-demo@example.com");
      const data = await lireProfil(request);
      const signal = data.signalResultatMission;

      const premiere = await request.post("/api/client/profil/faits", {
        data: { cle: signal.cle, action: "AJOUTER", valeur: signal.valeur, depuisSignal: true },
      });
      expect(premiere.status()).toBe(201);

      const doublon = await request.post("/api/client/profil/faits", {
        data: { cle: signal.cle, action: "AJOUTER", valeur: signal.valeur, depuisSignal: true },
      });
      expect(doublon.status()).toBe(409);
    });

    test("le fait confirmé apparaît ensuite dans faits (visible dans l'onglet Contraintes & Préférences côté client)", async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
      const profil = await creerProfil();
      await creerMissionEvaluee(client!.id, profil.id, 5);
      await creerMissionEvaluee(client!.id, profil.id, 5);

      await connecter(request, "client-demo@example.com");
      const avant = await lireProfil(request);
      const signal = avant.signalResultatMission;
      await request.post("/api/client/profil/faits", {
        data: { cle: signal.cle, action: "AJOUTER", valeur: signal.valeur, depuisSignal: true },
      });

      const apres = await lireProfil(request);
      expect(apres.faits.some((f: { cle: string; valeur: string }) => f.cle === "CRITERE_REUSSITE_DURABLE" && f.valeur === signal.valeur)).toBe(true);
    });
  });
});
