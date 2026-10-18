import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { versCompetencesPourMatching, type StatutPreuveCompetence } from "@/lib/talent/skill-graph";

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL (28/09/2026).
// Couvre le pont MISSION -> MissionSkillProposal -> Admin Review ->
// SkillEvidence(source=MISSION) -> Intelligence, sur ses 3 routes :
//   POST/GET /api/missions/[id]/skill-proposals
//   PATCH    /api/missions/[id]/skill-proposals/[proposalId]        (modification EN_ATTENTE)
//   PATCH    /api/profils/[id]/skill-proposals/[proposalId]         (validation/refus Admin)
//
// Isolation des données : la plupart des tests créent un Profil + une
// Mission DÉDIÉS (creerMissionDediee()) plutôt que de réutiliser le profil
// démo partagé "Ingénieur Démo" — indispensable ici car plusieurs tests
// vérifient des ÉTATS EXACTS (aucune preuve avant validation, exactement 1
// preuve après, etc.) qui seraient faussés par l'accumulation d'autres
// suites (ou d'autres tests de ce même fichier) sur un profil partagé.
// Seuls les tests qui exigent une VRAIE session Ingénieur authentifiée
// (RBAC de possession réelle : proposer/modifier sur SA PROPRE mission)
// utilisent creerMission(), liée au compte réel ingenieur-demo@example.com.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Reutilise la session deja authentifiee une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId — voir prisma/seed.ts");
  return user.profilId;
}

// Mission du VRAI compte ingenieur-demo@example.com — uniquement pour les
// tests qui doivent exercer une session Ingénieur authentifiée agissant sur
// sa propre mission.
async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test B47 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

// Profil + Mission entièrement dédiés à UN SEUL test — jamais de compte de
// connexion associé (aucun login réel possible pour ce profil), utilisé
// pour tous les scénarios où l'acteur qui agit est l'Admin (ou un rôle
// refusé avant toute vérification d'appartenance) : garantit un état de
// départ strictement vide, sans dépendre du nom de compétence choisi.
async function creerMissionDediee(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const suffixe = Date.now() + Math.random();
  const profil = await prisma.profil.create({ data: { nom: `Profil Dédié B47 ${suffixe}` } });
  const mission = await prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, repere: `Test B47 dédié ${suffixe}`, nbJours: 5, tjmVente: 400, statut },
  });
  return { mission, profil };
}

async function dernierJournal(action: string, cible: string) {
  return prisma.journalActivite.findFirst({ where: { action, cible }, orderBy: { createdAt: "desc" } });
}

test.describe("ATLAS PHASE 2B-1 — Mission Skill Proposal", () => {
  test.describe("Création — POST /api/missions/[id]/skill-proposals", () => {
    test("1. Engineer propriétaire crée une proposition sur sa propre mission -> 201", async () => {
      let request = await connecter("INGENIEUR");
      const mission = await creerMission();

      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, {
        data: { competence: "GCP", niveauPropose: 3, contexte: "Déploiement infra client" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
      const proposition = await reponse.json();
      expect(proposition.statut).toBe("EN_ATTENTE");
      expect(proposition.competence).toBe("GCP");
      expect(proposition.niveauPropose).toBe(3);
      expect(proposition.profilId).toBe(await profilIngenieurDemo());
      expect(proposition.proposeParEmail).toBe("ingenieur-demo@example.com");
      expect(proposition.proposeParRole).toBe("INGENIEUR");
    });

    test("2. Admin peut créer une proposition sur n'importe quelle mission -> 201", async () => {
      let request = await connecter("ADMIN");
      const { mission } = await creerMissionDediee();

      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, {
        data: { competence: "SOAP" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
      const proposition = await reponse.json();
      expect(proposition.proposeParRole).toBe("ADMIN");
      expect(proposition.niveauPropose).toBeNull();
    });

    test("3. Mission inexistante -> 404", async () => {
      let request = await connecter("ADMIN");
      const reponse = await request.post("/api/missions/inexistante-xyz/skill-proposals", { data: { competence: "GCP" } });
      expect(reponse.status()).toBe(404);
    });

    test("4. Engineer non propriétaire (mission d'un autre ingénieur) -> 404", async () => {
      let request = await connecter("INGENIEUR");
      const { mission } = await creerMissionDediee();

      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      expect(reponse.status()).toBe(404);
      expect(await prisma.missionSkillProposal.count({ where: { missionId: mission.id } })).toBe(0);
    });

    test("5. Client -> 403, aucune proposition créée", async () => {
      let request = await connecter("CLIENT");
      const { mission } = await creerMissionDediee();

      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      expect(reponse.status()).toBe(403);
      expect(await prisma.missionSkillProposal.count({ where: { missionId: mission.id } })).toBe(0);
    });

    test("6. Non authentifié -> 403", async ({ request }) => {
      const { mission } = await creerMissionDediee();
      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      expect(reponse.status()).toBe(403);
    });

    test("6b. Compétence hors du vocabulaire fermé -> 400, aucune création", async () => {
      let request = await connecter("ADMIN");
      const { mission } = await creerMissionDediee();
      const reponse = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "Compétence Inventée Inexistante" } });
      expect(reponse.status()).toBe(400);
    });
  });

  test.describe("Modification — PATCH /api/missions/[id]/skill-proposals/[proposalId]", () => {
    test("7. Engineer auteur peut modifier sa proposition EN_ATTENTE -> 200", async () => {
      let request = await connecter("INGENIEUR");
      const mission = await creerMission();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP", niveauPropose: 2 } });
      const proposition = await creation.json();

      const modif = await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 4, contexte: "Précision ajoutée" } });
      expect(modif.status(), await modif.text()).toBe(200);
      const apres = await modif.json();
      expect(apres.niveauPropose).toBe(4);
      expect(apres.contexte).toBe("Précision ajoutée");
    });

    test("8. Admin peut modifier une proposition EN_ATTENTE -> 200", async () => {
      let request = await connecter("ADMIN");
      const { mission } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();

      const modif = await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 5 } });
      expect(modif.status(), await modif.text()).toBe(200);
      expect((await modif.json()).niveauPropose).toBe(5);
    });

    test("9. Engineer ne peut pas modifier la proposition d'un autre auteur (créée par Admin sur sa mission) -> 404", async () => {
      let request = await connecter("ADMIN");
      const mission = await creerMission();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      request = await connecter("INGENIEUR");
      const modif = await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 2 } });
      expect(modif.status()).toBe(404);
    });

    test("10. Modification impossible après VALIDEE -> 409", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });

      const modif = await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 5 } });
      expect(modif.status()).toBe(409);
    });

    test("11. Modification impossible après REFUSEE -> 409", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "refuser" } });

      const modif = await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 5 } });
      expect(modif.status()).toBe(409);
    });
  });

  test.describe("Validation / refus — PATCH /api/profils/[id]/skill-proposals/[proposalId]", () => {
    test("12. Admin valide -> 200, statut VALIDEE", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP", niveauPropose: 2 } });
      const proposition = await creation.json();

      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 4 } });
      expect(decision.status(), await decision.text()).toBe(200);
      const apres = await decision.json();
      expect(apres.statut).toBe("VALIDEE");
      expect(apres.decidePar).toBe("admin-demo@example.com");
      expect(apres.skillEvidenceId).toBeTruthy();
    });

    test("13. Engineer ne peut pas valider -> 403", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();

      request = await connecter("INGENIEUR");
      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });
      expect(decision.status()).toBe(403);
    });

    test("14. Client ne peut pas valider -> 403", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      request = await connecter("CLIENT");
      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });
      expect(decision.status()).toBe(403);
    });

    test("15. Non authentifié -> 403", async ({ request }) => {
      const { profil } = await creerMissionDediee();
      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/inexistante`, { data: { action: "valider" } });
      expect(decision.status()).toBe(403);
    });

    test("16. Proposal inexistante -> 404", async () => {
      let request = await connecter("ADMIN");
      const { profil } = await creerMissionDediee();
      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/inexistante-xyz`, { data: { action: "valider" } });
      expect(decision.status()).toBe(404);
    });

    test("17. Profil de l'URL incohérent avec la proposition (cross-profil) -> 404, jamais 403", async () => {
      let request = await connecter("ADMIN");
      const { mission } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      const { profil: autreProfil } = await creerMissionDediee();
      const decision = await request.patch(`/api/profils/${autreProfil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });
      expect(decision.status()).toBe(404);
    });

    test("18. Action invalide -> 400", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();

      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "n'importe quoi" } });
      expect(decision.status()).toBe(400);
    });
  });

  test.describe("Preuve — SkillEvidence(source=MISSION)", () => {
    test("19. Aucune SkillEvidence avant validation", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });

      const pc = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId: profil.id, competence: "GCP" } } });
      expect(pc).toBeNull(); // aucune ProfilCompetence créée par la seule proposition
    });

    test("20. SkillEvidence(source=MISSION) créée après validation, détail traçable jusqu'à la mission", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 3, motif: "Revue technique" } });

      const pc = await prisma.profilCompetence.findUnique({
        where: { profilId_competence: { profilId: profil.id, competence: "GCP" } },
        include: { preuves: true },
      });
      expect(pc).toBeTruthy();
      expect(pc!.statut).toBe("DECLARE");
      expect(pc!.preuves.length).toBe(1); // état vierge -> exactement 1 preuve créée
      const preuveMission = pc!.preuves.find((p) => p.source === "MISSION");
      expect(preuveMission).toBeTruthy();
      expect(preuveMission!.niveau).toBe(3);
      expect(preuveMission!.detail).toContain(mission.repere ?? mission.id);
      expect(preuveMission!.detail).toContain("admin-demo@example.com");
    });

    test("21/22. niveauObserve utilisé, niveauPropose ne devient JAMAIS automatiquement le niveau de preuve", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP", niveauPropose: 2 } });
      const proposition = await creation.json();

      // L'Admin valide avec un niveauObserve DIFFÉRENT du niveauPropose.
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 5 } });

      const pc = await prisma.profilCompetence.findUnique({
        where: { profilId_competence: { profilId: profil.id, competence: "SOAP" } },
        include: { preuves: true },
      });
      const preuve = pc!.preuves.find((p) => p.source === "MISSION");
      expect(preuve!.niveau).toBe(5); // niveauObserve, jamais niveauPropose (2)
      expect(preuve!.niveau).not.toBe(2);
    });

    test("22b. niveauObserve omis à la validation -> SkillEvidence.niveau reste null, jamais déduit de niveauPropose", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP", niveauPropose: 4 } });
      const proposition = await creation.json();

      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } }); // pas de niveauObserve

      const pc = await prisma.profilCompetence.findUnique({
        where: { profilId_competence: { profilId: profil.id, competence: "GCP" } },
        include: { preuves: true },
      });
      const preuve = pc!.preuves.find((p) => p.source === "MISSION");
      expect(preuve!.niveau).toBeNull();
    });

    test("23. Refus -> aucune SkillEvidence créée", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();

      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "refuser", motif: "Contexte insuffisant" } });
      expect(decision.status()).toBe(200);
      expect((await decision.json()).statut).toBe("REFUSEE");

      const pc = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId: profil.id, competence: "SOAP" } } });
      expect(pc).toBeNull(); // aucune ProfilCompetence/SkillEvidence créée par un refus
    });
  });

  test.describe("Idempotence / concurrence", () => {
    test("24. Double validation concurrente de la même proposition -> exactement 1 SkillEvidence, la 2e requête reçoit 409", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      const [r1, r2] = await Promise.all([
        request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 3 } }),
        request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 3 } }),
      ]);
      const statuts = [r1.status(), r2.status()].sort();
      expect(statuts).toEqual([200, 409]);

      const pc = await prisma.profilCompetence.findUnique({
        where: { profilId_competence: { profilId: profil.id, competence: "GCP" } },
        include: { preuves: true },
      });
      expect(pc!.preuves.filter((p) => p.source === "MISSION").length).toBe(1); // jamais 2
    });

    test("25. Double création concurrente EN_ATTENTE (même mission+compétence) -> une seule proposition active, l'autre 409", async () => {
      let request = await connecter("INGENIEUR");
      const mission = await creerMission();

      const [r1, r2] = await Promise.all([
        request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } }),
        request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } }),
      ]);
      const statuts = [r1.status(), r2.status()].sort();
      expect(statuts).toEqual([201, 409]);

      const actives = await prisma.missionSkillProposal.count({ where: { missionId: mission.id, competence: "SOAP", statut: "EN_ATTENTE" } });
      expect(actives).toBe(1); // jamais 2 propositions EN_ATTENTE identiques actives
    });
  });

  test.describe("Historique", () => {
    test("26/27. Refus -> nouvelle proposition possible pour la même compétence, l'ancienne reste REFUSEE (jamais rouverte)", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();

      const premiere = await (await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } })).json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${premiere.id}`, { data: { action: "refuser", motif: "Pas assez de contexte" } });

      const seconde = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP", contexte: "Contexte complété" } });
      expect(seconde.status(), await seconde.text()).toBe(201);
      const secondeJson = await seconde.json();
      expect(secondeJson.id).not.toBe(premiere.id);

      const premiereEnBase = await prisma.missionSkillProposal.findUnique({ where: { id: premiere.id } });
      expect(premiereEnBase?.statut).toBe("REFUSEE"); // jamais rouverte automatiquement
    });

    test("28. Une SkillEvidence créée par validation reste immuable après une consultation ultérieure", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 2 } });

      const avant = await prisma.skillEvidence.findFirst({ where: { source: "MISSION", profilCompetence: { profilId: profil.id, competence: "SOAP" } } });
      await request.get(`/api/profils/${profil.id}/competences`); // simple lecture, ne doit rien muter
      const apres = await prisma.skillEvidence.findFirst({ where: { source: "MISSION", profilCompetence: { profilId: profil.id, competence: "SOAP" } } });

      expect(apres).toEqual(avant); // strictement identique, aucune mutation
    });
  });

  test.describe("Audit (journaliser())", () => {
    test("29. mission.skill_proposal.created", async () => {
      let request = await connecter("INGENIEUR");
      const mission = await creerMission();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();

      const entree = await dernierJournal("mission.skill_proposal.created", `proposal:${proposition.id}`);
      expect(entree).toBeTruthy();
      expect(entree!.acteurEmail).toBe("ingenieur-demo@example.com");
    });

    test("30. mission.skill_proposal.updated (uniquement si un champ change réellement)", async () => {
      let request = await connecter("INGENIEUR");
      const mission = await creerMission();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP", niveauPropose: 1 } });
      const proposition = await creation.json();

      await request.patch(`/api/missions/${mission.id}/skill-proposals/${proposition.id}`, { data: { niveauPropose: 3 } });
      const entree = await dernierJournal("mission.skill_proposal.updated", `proposal:${proposition.id}`);
      expect(entree).toBeTruthy();
      expect(entree!.detail).toContain("niveauPropose");
    });

    test("31. mission.skill_proposal.validated (contient le skillEvidenceId)", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();
      const decision = await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });
      const apres = await decision.json();

      const entree = await dernierJournal("mission.skill_proposal.validated", `proposal:${proposition.id}`);
      expect(entree).toBeTruthy();
      expect(entree!.detail).toContain(apres.skillEvidenceId);
      expect(entree!.detail).toContain(mission.id);
      expect(entree!.detail).toContain(profil.id);
    });

    test("32. mission.skill_proposal.rejected (contient le motif)", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "refuser", motif: "Pas convaincant" } });

      const entree = await dernierJournal("mission.skill_proposal.rejected", `proposal:${proposition.id}`);
      expect(entree).toBeTruthy();
      expect(entree!.detail).toContain("Pas convaincant");
    });
  });

  test.describe("Intelligence — Professional Intelligence Console / Matching", () => {
    test("33/34. La preuve validée est visible dans /api/profils/[id]/competences et l'intelligence est recalculée à la lecture", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "GCP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider", niveauObserve: 3 } });

      const competences = await (await request.get(`/api/profils/${profil.id}/competences`)).json();
      const gcp = competences.competences.find((c: { competence: string }) => c.competence === "GCP");
      expect(gcp).toBeTruthy();
      expect(gcp.statut).toBe("DECLARE");
      expect(gcp.confianceDetaillee.provenancePrincipale).toBe("MISSION");
      expect(gcp.confianceDetaillee.nombrePreuves).toBe(1);

      const trust = await (await request.get(`/api/profils/${profil.id}/talent-trust`)).json();
      const gcpIntel = trust.candidateIntelligence.competences.declarees.find((c: { competence: string }) => c.competence === "GCP");
      expect(gcpIntel).toBeTruthy();
      expect(gcpIntel.confianceDetaillee.confiance).not.toBe("INCONNUE");
    });

    test("35. La compétence validée entre dans versCompetencesPourMatching (chemin Matching existant, non modifié)", async () => {
      let request = await connecter("ADMIN");
      const { mission, profil } = await creerMissionDediee();
      const creation = await request.post(`/api/missions/${mission.id}/skill-proposals`, { data: { competence: "SOAP" } });
      const proposition = await creation.json();
      await request.patch(`/api/profils/${profil.id}/skill-proposals/${proposition.id}`, { data: { action: "valider" } });

      const competences = await (await request.get(`/api/profils/${profil.id}/competences`)).json();
      const eligibles = versCompetencesPourMatching(
        competences.competences.map((c: { competence: string; statut: StatutPreuveCompetence }) => ({ competence: c.competence, statut: c.statut }))
      );
      expect(eligibles).toContain("SOAP");
    });
  });
});
