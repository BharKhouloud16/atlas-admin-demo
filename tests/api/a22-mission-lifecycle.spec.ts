import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission, MissionAssignmentRole, MissionAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A22 : Mission Lifecycle Engine (05/10/2026).
//
// Couvre les 46 scénarios du mandat A22 §27 : matrice de transitions
// complète (valides + invalides), préconditions Assignment (A20),
// blocage/déblocage, terminaison (sans précondition WorkItem/Deliverable/
// Evidence/Quality/Outcome — ces modèles n'existent d'ailleurs pas dans ce
// schéma, donc l'absence de précondition se vérifie sur OutcomeAssessment/
// OutcomeEvidence, les seuls modèles "résultat" réellement présents),
// annulation (motif obligatoire), RBAC, concurrence, idempotence, et
// non-interférence avec MissionAssignment.statut (A20) et
// MissionCapabilityLink.statut (A21).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
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

async function creerProfilTalent() {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.profil.create({ data: { nom: `Talent Test A22 ${suffixe}` } });
}

async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test A22 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerAssignment(
  missionId: string,
  overrides: { statut?: MissionAssignmentStatut; estResponsablePrincipal?: boolean; talentId?: string } = {}
) {
  const talentId = overrides.talentId ?? (await creerProfilTalent()).id;
  return prisma.missionAssignment.create({
    data: {
      missionId,
      talentId,
      role: MissionAssignmentRole.RESPONSABLE_PRINCIPAL,
      statut: overrides.statut ?? MissionAssignmentStatut.ACTIF,
      dateDebut: new Date(),
      estResponsablePrincipal: overrides.estResponsablePrincipal ?? false,
      createdByEmail: "admin-demo@example.com",
    },
  });
}

async function transition(
  request: APIRequestContext,
  missionId: string,
  action: string,
  extra: Record<string, unknown> = {}
) {
  return request.patch(`/api/missions/${missionId}/transition`, { data: { action, ...extra } });
}

test.describe("A22 — Machine de transitions : chemins valides", () => {
  test("1. PLANIFIEE -> PRETE (avec Assignment ACTIF)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    await creerAssignment(mission.id);

    const reponse = await transition(request, mission.id, "rendre_prete");
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("PRETE");
  });

  test("2. PRETE -> EN_COURS (avec Assignment ACTIF + responsable principal)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    await creerAssignment(mission.id, { estResponsablePrincipal: true });

    const reponse = await transition(request, mission.id, "demarrer");
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("EN_COURS");
  });

  test("3. PRETE -> BLOQUEE (avec raison valide)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);

    const reponse = await transition(request, mission.id, "bloquer", { raison: "TECHNICAL" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("BLOQUEE");
  });

  test("4. PRETE -> ANNULEE (avec motif)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);

    const reponse = await transition(request, mission.id, "annuler", { motif: "Test A22" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULEE");
  });

  test("5. EN_COURS -> BLOQUEE (avec raison valide)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "bloquer", { raison: "CLIENT_DEPENDENCY" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("BLOQUEE");
  });

  test("6. EN_COURS -> TERMINEE (aucune précondition)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("TERMINEE");
  });

  test("7. EN_COURS -> ANNULEE (avec motif)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "annuler", { motif: "Test A22" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULEE");
  });

  test("8. BLOQUEE -> EN_COURS (avec raisonResolution)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "debloquer", { raisonResolution: "Dépendance levée" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("EN_COURS");
  });

  test("9. BLOQUEE -> TERMINEE (avec motif, requis depuis BLOQUEE)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "terminer", { motif: "Clôturée malgré blocage" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("TERMINEE");
  });

  test("10. BLOQUEE -> ANNULEE (avec motif)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "annuler", { motif: "Test A22" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULEE");
  });

  test("11. PLANIFIEE -> ANNULEE (avec motif)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);

    const reponse = await transition(request, mission.id, "annuler", { motif: "Test A22" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULEE");
  });
});

test.describe("A22 — Machine de transitions : chemins interdits (toujours refusés, aucune mutation)", () => {
  async function attendreRefus(request: APIRequestContext, statutDepart: StatutMission, action: string, extra: Record<string, unknown> = {}) {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(statutDepart);
    const reponse = await transition(request, mission.id, action, extra);
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe(statutDepart);
  }

  test("12. PLANIFIEE -> EN_COURS (saut interdit, pas de 'demarrer' sans passer par PRETE)", async ({ request }) => {
    await attendreRefus(request, StatutMission.PLANIFIEE, "demarrer");
  });

  test("13. PLANIFIEE -> BLOQUEE (interdit)", async ({ request }) => {
    await attendreRefus(request, StatutMission.PLANIFIEE, "bloquer", { raison: "TECHNICAL" });
  });

  test("14. PLANIFIEE -> TERMINEE (interdit)", async ({ request }) => {
    await attendreRefus(request, StatutMission.PLANIFIEE, "terminer");
  });

  test("15. PRETE -> PRETE (déjà PRETE, 'rendre_prete' refusé)", async ({ request }) => {
    await attendreRefus(request, StatutMission.PRETE, "rendre_prete");
  });

  test("16. PRETE -> TERMINEE (interdit, doit démarrer d'abord)", async ({ request }) => {
    await attendreRefus(request, StatutMission.PRETE, "terminer");
  });

  test("17. TERMINEE -> toute action (état terminal)", async ({ request }) => {
    await attendreRefus(request, StatutMission.TERMINEE, "terminer");
    await attendreRefus(request, StatutMission.TERMINEE, "annuler", { motif: "x" });
    await attendreRefus(request, StatutMission.TERMINEE, "bloquer", { raison: "TECHNICAL" });
    await attendreRefus(request, StatutMission.TERMINEE, "rendre_prete");
    await attendreRefus(request, StatutMission.TERMINEE, "demarrer");
    await attendreRefus(request, StatutMission.TERMINEE, "debloquer", { raisonResolution: "x" });
  });

  test("18. ANNULEE -> toute action (état terminal)", async ({ request }) => {
    await attendreRefus(request, StatutMission.ANNULEE, "terminer");
    await attendreRefus(request, StatutMission.ANNULEE, "annuler", { motif: "x" });
    await attendreRefus(request, StatutMission.ANNULEE, "bloquer", { raison: "TECHNICAL" });
    await attendreRefus(request, StatutMission.ANNULEE, "rendre_prete");
    await attendreRefus(request, StatutMission.ANNULEE, "demarrer");
    await attendreRefus(request, StatutMission.ANNULEE, "debloquer", { raisonResolution: "x" });
  });
});

test.describe("A22 — Précondition Assignment (A20)", () => {
  test("19. PLANIFIEE -> PRETE sans Assignment ACTIF -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);

    const reponse = await transition(request, mission.id, "rendre_prete");
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("PLANIFIEE");
  });

  test("20. PLANIFIEE -> PRETE avec Assignment ACTIF -> 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    await creerAssignment(mission.id, { statut: MissionAssignmentStatut.ACTIF });

    const reponse = await transition(request, mission.id, "rendre_prete");
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  test("21. PRETE -> EN_COURS sans responsable principal ACTIF -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    // Assignment ACTIF présent mais PAS responsable principal.
    await creerAssignment(mission.id, { estResponsablePrincipal: false });

    const reponse = await transition(request, mission.id, "demarrer");
    expect(reponse.status()).toBe(409);
    expect((await reponse.json()).error).toContain("estResponsablePrincipal");
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("PRETE");
  });

  test("22. PRETE -> EN_COURS avec responsable principal ACTIF -> 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    await creerAssignment(mission.id, { estResponsablePrincipal: true });

    const reponse = await transition(request, mission.id, "demarrer");
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  test("22b. Assignment TERMINE (non ACTIF) ne compte pas comme précondition satisfaite", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    await creerAssignment(mission.id, { statut: MissionAssignmentStatut.TERMINE });

    const reponse = await transition(request, mission.id, "rendre_prete");
    expect(reponse.status()).toBe(409);
  });
});

test.describe("A22 — Blocage / déblocage", () => {
  test("23. PRETE -> BLOQUEE sans raison -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);

    const reponse = await transition(request, mission.id, "bloquer");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("PRETE");
  });

  test("24. EN_COURS -> BLOQUEE sans raison -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "bloquer");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("25. Bloquer avec raison invalide (hors catalogue) -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "bloquer", { raison: "PAS_DANS_LE_CATALOGUE" });
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("26. Bloquer avec raison valide -> 200, journalisée avec la raison", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "bloquer", { raison: "ACCESS" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.detail).toContain("ACCESS");
  });

  test("27. BLOQUEE -> EN_COURS sans raisonResolution -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "debloquer");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("BLOQUEE");
  });

  test("28. BLOQUEE -> EN_COURS avec raisonResolution -> 200, journalisée avec la résolution", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "debloquer", { raisonResolution: "Accès restauré" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.detail).toContain("Accès restauré");
  });
});

test.describe("A22 — Terminaison : aucune précondition WorkItem/Deliverable/Evidence/Quality/Outcome", () => {
  // WorkItem/Deliverable/DeliveryEvidence/DeliveryQualityGate (introduits
  // respectivement par A23/A25/A26/A27, tous ultérieurs à ce lot) restent
  // des domaines indépendants du lifecycle Mission (contrat A22 §8 :
  // concepts explicitement hors périmètre, jamais introduits par ce lot,
  // jamais une précondition/conséquence de la terminaison). Les seuls
  // modèles "résultat" réellement présents au moment d'A22 sont
  // OutcomeAssessment/OutcomeEvidence (A6.1) : on vérifie ici qu'aucun des
  // deux n'est requis NI créé par la terminaison.

  test("29. EN_COURS -> TERMINEE sans aucune OutcomeAssessment -> 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const avant = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(avant).toBe(0);

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  test("30. EN_COURS -> TERMINEE ne crée aucune OutcomeAssessment automatiquement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);

    const apres = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(apres).toBe(0);
  });

  test("31. EN_COURS -> TERMINEE ne crée aucune OutcomeEvidence automatiquement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);

    // Pas de colonne missionId directe sur OutcomeEvidence (chaîne
    // criterion -> assessment -> mission) : comme aucun OutcomeAssessment
    // n'existe pour cette Mission (test 30), aucune OutcomeEvidence ne peut
    // lui être rattachée — la requête nested le confirme explicitement.
    const apres = await prisma.outcomeEvidence.count({ where: { criterion: { assessment: { missionId: mission.id } } } });
    expect(apres).toBe(0);
  });

  test("32. BLOQUEE -> TERMINEE (avec motif) sans aucune précondition résultat -> 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);

    const reponse = await transition(request, mission.id, "terminer", { motif: "Clôture sans résultat tracé" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const apres = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(apres).toBe(0);
  });

  test("33. EN_COURS -> TERMINEE ne touche jamais MissionAssignment/MissionCapabilityLink", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const assignment = await creerAssignment(mission.id, { estResponsablePrincipal: true });

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);

    const assignmentApres = await prisma.missionAssignment.findUnique({ where: { id: assignment.id } });
    expect(assignmentApres?.statut).toBe("ACTIF"); // inchangé — jamais auto-TERMINE.
  });
});

test.describe("A22 — Annulation : motif obligatoire quel que soit le statut de départ", () => {
  test("34a. PLANIFIEE -> ANNULEE sans motif -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    const reponse = await transition(request, mission.id, "annuler");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("PLANIFIEE");
  });

  test("34b. PRETE -> ANNULEE sans motif -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    const reponse = await transition(request, mission.id, "annuler");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("PRETE");
  });

  test("34c. EN_COURS -> ANNULEE sans motif -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await transition(request, mission.id, "annuler");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("34d. BLOQUEE -> ANNULEE sans motif -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);
    const reponse = await transition(request, mission.id, "annuler");
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("BLOQUEE");
  });

  test("35a. PLANIFIEE -> ANNULEE avec motif -> 200, motif journalisé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    const reponse = await transition(request, mission.id, "annuler", { motif: "Besoin client retiré" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.detail).toContain("Besoin client retiré");
  });

  test("35b. EN_COURS -> ANNULEE avec motif -> 200, motif journalisé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await transition(request, mission.id, "annuler", { motif: "Fin de contrat anticipée" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.detail).toContain("Fin de contrat anticipée");
  });
});

test.describe("A22 — RBAC : Admin uniquement, jamais l'Agent/Ingénieur/Client", () => {
  test("36. Admin peut exécuter toute action du moteur -> 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  test("37. Client ne peut exécuter aucune action du moteur -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await transition(request, mission.id, "bloquer", { raison: "TECHNICAL" });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("38. Ingénieur ne peut exécuter aucune action du moteur (même sur sa propre Mission) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await transition(request, mission.id, "bloquer", { raison: "TECHNICAL" });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("39. Aucune route dédiée Agent n'existe pour ces actions (même endpoint que l'Admin, refusé pour tout non-Admin)", async ({ request }) => {
    // Pas de rôle AGENT distinct dans ce système (ADMIN/INGENIEUR/CLIENT) —
    // ce test confirme qu'aucun rôle non-ADMIN, quel qu'il soit, ne passe
    // par une autre voie : même route, même vérification RBAC unique.
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    const reponse = await transition(request, mission.id, "rendre_prete");
    expect(reponse.status()).toBe(403);
  });
});

test.describe("A22 — Concurrence : un seul gagnant, aucune écrasement", () => {
  test("40. Deux 'terminer' simultanés sur la même Mission EN_COURS -> un seul 200, un seul 409", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const [r1, r2] = await Promise.all([transition(request, mission.id, "terminer"), transition(request, mission.id, "terminer")]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("TERMINEE");
  });

  test("41. 'terminer' et 'annuler' simultanés sur la même Mission EN_COURS -> un seul gagnant, état final cohérent", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const [r1, r2] = await Promise.all([
      transition(request, mission.id, "terminer"),
      transition(request, mission.id, "annuler", { motif: "Course concurrente" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(["TERMINEE", "ANNULEE"]).toContain(enBase?.statut);
  });

  test("42. Deux 'terminer' simultanés -> une seule ligne JournalActivite créée pour ce couple (pas de doublon)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const avant = Date.now();

    await Promise.all([transition(request, mission.id, "terminer"), transition(request, mission.id, "terminer")]);

    const lignes = await prisma.journalActivite.findMany({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}`, createdAt: { gte: new Date(avant - 1000) } },
    });
    expect(lignes.length).toBe(1);
  });
});

test.describe("A22 — Idempotence : répéter une transition déjà effectuée est proprement refusé", () => {
  test("43. Répéter 'terminer' sur une Mission déjà TERMINEE -> 409, aucune nouvelle ligne de journal", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const premiere = await transition(request, mission.id, "terminer");
    expect(premiere.status()).toBe(200);
    const lignesApresPremiere = await prisma.journalActivite.count({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
    });

    const seconde = await transition(request, mission.id, "terminer");
    expect(seconde.status()).toBe(409);
    const lignesApresSeconde = await prisma.journalActivite.count({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
    });
    expect(lignesApresSeconde).toBe(lignesApresPremiere);
  });

  test("44. Répéter 'annuler' sur une Mission déjà ANNULEE -> 409, aucune nouvelle ligne de journal", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);

    const premiere = await transition(request, mission.id, "annuler", { motif: "Première annulation" });
    expect(premiere.status()).toBe(200);
    const lignesApresPremiere = await prisma.journalActivite.count({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
    });

    const seconde = await transition(request, mission.id, "annuler", { motif: "Seconde tentative" });
    expect(seconde.status()).toBe(409);
    const lignesApresSeconde = await prisma.journalActivite.count({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
    });
    expect(lignesApresSeconde).toBe(lignesApresPremiere);
  });
});

test.describe("A22 — Non-interférence avec A20 (MissionAssignment) et A21 (MissionCapabilityLink)", () => {
  test("45. Toute transition Mission.statut ne modifie jamais MissionAssignment.statut d'aucun Assignment lié", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    const actif = await creerAssignment(mission.id, { estResponsablePrincipal: true, statut: MissionAssignmentStatut.ACTIF });
    const planifie = await creerAssignment(mission.id, { statut: MissionAssignmentStatut.PLANIFIE });

    const demarrer = await transition(request, mission.id, "demarrer");
    expect(demarrer.status(), await demarrer.text()).toBe(200);
    const terminer = await transition(request, mission.id, "terminer");
    expect(terminer.status(), await terminer.text()).toBe(200);

    const actifApres = await prisma.missionAssignment.findUnique({ where: { id: actif.id } });
    const planifieApres = await prisma.missionAssignment.findUnique({ where: { id: planifie.id } });
    expect(actifApres?.statut).toBe("ACTIF");
    expect(planifieApres?.statut).toBe("PLANIFIE");
  });

  test("46. Toute transition Mission.statut ne modifie jamais MissionCapabilityLink.statut d'aucun lien actif", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const lien = await prisma.missionCapabilityLink.create({
      data: {
        missionId: mission.id,
        capability: "Capacité Test A22",
        statut: "ACTIVE",
        createdByEmail: "admin-demo@example.com",
      },
    });

    const reponse = await transition(request, mission.id, "terminer");
    expect(reponse.status(), await reponse.text()).toBe(200);

    const lienApres = await prisma.missionCapabilityLink.findUnique({ where: { id: lien.id } });
    expect(lienApres?.statut).toBe("ACTIVE");
  });
});
