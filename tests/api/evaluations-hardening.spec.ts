import { test, expect, request as apiRequest, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ATLAS — EVALUATION API HARDENING & TEST SUITE (lot dédié, voir audit
// "Evaluation API Hardening & Test Audit"). Avant ce lot, la SEULE ligne de
// test qui appelait réellement POST /api/evaluations était
// tests/api/b46-mission-lifecycle.spec.ts:236, comme précondition d'un
// autre lot — jamais un test de la route elle-même. Ce fichier couvre
// RBAC/ownership/statut/validation/concurrence/GET pour cette route
// précisément, sans jamais toucher au lifecycle Mission ou à l'intelligence
// (voir tests "Intelligence isolation" ci-dessous, qui verrouillent
// explicitement l'absence d'effet sur SkillEvidence/ProfilCompetence).
//
// Isolation des données : chaque test crée son propre Profil + Mission
// dédiés (jamais le profil de démo partagé "Ingénieur Démo") — indispensable
// ici car plusieurs tests vérifient des ÉTATS EXACTS (aucune évaluation
// avant création, exactement une après, etc.).

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

// Second Client, entièrement dédié, jamais le même que clientDemo() — pour
// les scénarios IDOR où l'attaquant (client-demo, session réelle) tente
// d'agir sur une Mission qui ne lui appartient pas.
async function autreClient() {
  const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.client.create({ data: { nom: `Client Eval Hardening ${suffixe}` } });
}

async function missionDediee(statut: StatutMission = StatutMission.TERMINEE, clientId?: string) {
  const client = clientId ? { id: clientId } : await clientDemo();
  const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const profil = await prisma.profil.create({ data: { nom: `Profil Eval Hardening ${suffixe}` } });
  const mission = await prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, repere: `EvalHardening ${suffixe}`, nbJours: 5, tjmVente: 400, statut },
  });
  return { mission, profil };
}

test.describe("EVALUATION API HARDENING — POST /api/evaluations — RBAC", () => {
  test("1. Client authentifié évalue sa propre mission terminée -> 201", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.note).toBe(4);
    expect(corps.missionId).toBe(mission.id);
  });

  test("2. Admin -> 403, aucune évaluation créée", async () => {
    let request = await connecter("ADMIN");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(reponse.status()).toBe(403);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });

  test("3. Engineer -> 403, aucune évaluation créée", async () => {
    let request = await connecter("INGENIEUR");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(reponse.status()).toBe(403);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });

  test("4. Non authentifié -> 403 (comportement contractuel actuel conservé)", async ({ request }) => {
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(reponse.status()).toBe(403);
  });
});

test.describe("EVALUATION API HARDENING — Ownership / IDOR", () => {
  test("5. Client A ne peut pas évaluer une Mission du Client B -> 404, aucune création", async () => {
    const clientB = await autreClient();
    const { mission } = await missionDediee(StatutMission.TERMINEE, clientB.id);

    let request = await connecter("CLIENT"); // Client A, réel
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 5 } });
    expect(reponse.status()).toBe(404);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });

  test("6. Mission inexistante -> 404", async () => {
    let request = await connecter("CLIENT");
    const reponse = await request.post("/api/evaluations", { data: { missionId: "mission-inexistante-xyz", note: 5 } });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("EVALUATION API HARDENING — Mission status", () => {
  test("7. Mission Terminée -> succès", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 3 } });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("8. Mission En cours -> 400, aucune création", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.EN_COURS);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 3 } });
    expect(reponse.status()).toBe(400);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });

  test("9. Mission Annulée -> 400, aucune création", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.ANNULEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 3 } });
    expect(reponse.status()).toBe(400);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });
});

test.describe("EVALUATION API HARDENING — note", () => {
  const casValides = [1, 5];
  for (const note of casValides) {
    test(`10/11. note = ${note} -> 201`, async () => {
      let request = await connecter("CLIENT");
      const { mission } = await missionDediee(StatutMission.TERMINEE);
      const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note } });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).note).toBe(note);
    });
  }

  const casInvalides: { label: string; note: unknown }[] = [
    { label: "0", note: 0 },
    { label: "6", note: 6 },
    { label: "-1", note: -1 },
    { label: "décimale 1.5", note: 1.5 },
    { label: "type invalide (objet)", note: { valeur: 5 } },
    { label: "type invalide (tableau)", note: [5] },
    { label: "type invalide (booléen)", note: true },
    { label: "null", note: null },
  ];
  for (const cas of casInvalides) {
    test(`12-16. note = ${cas.label} -> 400, aucune création`, async () => {
      let request = await connecter("CLIENT");
      const { mission } = await missionDediee(StatutMission.TERMINEE);
      const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: cas.note } });
      expect(reponse.status(), await reponse.text()).toBe(400);
      expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
    });
  }

  test("note fournie en chaîne numérique ('5') -> 201 (contrat existant préservé, voir lib/validation.ts::evaluationSchema)", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: "5" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).note).toBe(5);
  });

  test("missionId absent -> 400, jamais un crash", async () => {
    let request = await connecter("CLIENT");
    const reponse = await request.post("/api/evaluations", { data: { note: 3 } });
    expect(reponse.status()).toBe(400);
  });

  test("missionId de type invalide (nombre) -> 400, jamais atteindre Prisma sans validation", async () => {
    let request = await connecter("CLIENT");
    const reponse = await request.post("/api/evaluations", { data: { missionId: 12345, note: 3 } });
    expect(reponse.status(), await reponse.text()).toBe(400);
  });

  test("body JSON invalide -> 400 propre, jamais un 500", async () => {
    let request = await connecter("CLIENT");
    const reponse = await request.post("/api/evaluations", {
      headers: { "Content-Type": "application/json" },
      data: "{ceci n'est pas du JSON valide",
    });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("EVALUATION API HARDENING — commentaire", () => {
  test("17. commentaire absent -> stocké comme null", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toBeNull();
  });

  test("18. commentaire = null -> stocké comme null", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: null } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toBeNull();
  });

  test("19. commentaire = '' -> stocké comme null", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: "" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toBeNull();
  });

  test("20. commentaire = espaces uniquement -> stocké comme null", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: "    " } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toBeNull();
  });

  test("21. commentaire normal -> stocké trimmé", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: "  Très bonne mission  " } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toBe("Très bonne mission");
  });

  test("22. commentaire de 2000 caractères -> accepté", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const commentaire = "a".repeat(2000);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).commentaire).toHaveLength(2000);
  });

  test("23. commentaire de 2001 caractères -> 400, aucune création", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const commentaire = "a".repeat(2001);
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire } });
    expect(reponse.status(), await reponse.text()).toBe(400);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
  });

  const commentairesTypeInvalide: { label: string; commentaire: unknown }[] = [
    { label: "objet", commentaire: { texte: "bien" } },
    { label: "tableau", commentaire: ["bien"] },
    { label: "nombre", commentaire: 42 },
  ];
  for (const cas of commentairesTypeInvalide) {
    test(`24-26. commentaire de type invalide (${cas.label}) -> 400, aucune création`, async () => {
      let request = await connecter("CLIENT");
      const { mission } = await missionDediee(StatutMission.TERMINEE);
      const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: cas.commentaire } });
      expect(reponse.status(), await reponse.text()).toBe(400);
      expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(0);
    });
  }

  test("commentaire contenant du HTML/script -> stocké tel quel comme texte, jamais transformé (aucune sanitization ajoutée)", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const commentaire = "<script>alert(1)</script> très bien";
    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire } });
    expect(reponse.status(), await reponse.text()).toBe(201);
    // Stocké littéralement, sans échappement ni suppression — la sûreté
    // vient du rendu React côté affichage (JSX échappé), jamais d'une
    // transformation à l'écriture (voir audit §5/§7 : aucun sink HTML
    // n'existe dans ce repository).
    expect((await reponse.json()).commentaire).toBe(commentaire);
  });
});

test.describe("EVALUATION API HARDENING — Double évaluation / concurrence", () => {
  test("27/28. première évaluation -> 201, deuxième séquentielle -> 409", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);

    const premiere = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4 } });
    expect(premiere.status(), await premiere.text()).toBe(201);

    const seconde = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 2 } });
    expect(seconde.status()).toBe(409);

    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(1);
  });

  test("29. deux POST concurrents sur la même mission -> exactement 1 évaluation créée, jamais de 500 (P2002 -> 409)", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);

    const [a, b] = await Promise.all([
      request.post("/api/evaluations", { data: { missionId: mission.id, note: 5 } }),
      request.post("/api/evaluations", { data: { missionId: mission.id, note: 1 } }),
    ]);

    const statuts = [a.status(), b.status()].sort();
    // Le vainqueur reçoit 201, le perdant 409 (séquentiel OU capture P2002
    // selon l'ordre réel d'exécution) — jamais un 500 dans les deux cas.
    expect(statuts).toEqual([201, 409]);
    expect(await prisma.evaluation.count({ where: { missionId: mission.id } })).toBe(1);
  });
});

test.describe("EVALUATION API HARDENING — Intelligence isolation (garde-fou de non-régression)", () => {
  test("une création d'Evaluation ne crée ni ne modifie aucune SkillEvidence ni ProfilCompetence", async () => {
    let request = await connecter("CLIENT");
    const { mission, profil } = await missionDediee(StatutMission.TERMINEE);

    const preuvesAvant = await prisma.skillEvidence.count({ where: { profilCompetence: { profilId: profil.id } } });
    const competencesAvant = await prisma.profilCompetence.count({ where: { profilId: profil.id } });

    const reponse = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 5, commentaire: "Python : excellent" } });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const preuvesApres = await prisma.skillEvidence.count({ where: { profilCompetence: { profilId: profil.id } } });
    const competencesApres = await prisma.profilCompetence.count({ where: { profilId: profil.id } });

    expect(preuvesApres).toBe(preuvesAvant);
    expect(competencesApres).toBe(competencesAvant);
    expect(preuvesAvant).toBe(0);
    expect(competencesAvant).toBe(0);
  });
});

test.describe("EVALUATION API HARDENING — GET /api/evaluations", () => {
  test("30/31. GET Client -> uniquement ses propres missions terminées, jamais celles d'un autre Client", async () => {
    const clientB = await autreClient();
    const { mission: missionA } = await missionDediee(StatutMission.TERMINEE);
    const { mission: missionB } = await missionDediee(StatutMission.TERMINEE, clientB.id);

    let request = await connecter("CLIENT"); // Client A
    const reponse = await request.get("/api/evaluations");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { missions } = await reponse.json();
    const reperes: string[] = missions.map((m: { repere: string | null }) => m.repere);

    expect(reperes).toContain(missionA.repere);
    expect(reperes).not.toContain(missionB.repere);
  });

  test("32. GET Admin -> comportement actuel conservé (toutes les évaluations, non refondu dans ce lot)", async () => {
    let request = await connecter("CLIENT");
    const { mission } = await missionDediee(StatutMission.TERMINEE);
    const creation = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 4, commentaire: "Admin GET test" } });
    expect(creation.status()).toBe(201);
    const evaluationId = (await creation.json()).id;

    request = await connecter("ADMIN");
    const reponse = await request.get("/api/evaluations");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { evaluations } = await reponse.json();
    const trouvee = evaluations.find((e: { id: string }) => e.id === evaluationId);
    expect(trouvee, "l'Admin doit toujours voir l'évaluation créée (comportement inchangé)").toBeTruthy();
    expect(trouvee.mission.client).toBeTruthy();
    expect(trouvee.mission.profil).toBeTruthy();
  });

  test("33. GET Engineer -> 403", async () => {
    let request = await connecter("INGENIEUR");
    const reponse = await request.get("/api/evaluations");
    expect(reponse.status()).toBe(403);
  });

  // CONSTAT (voir rapport final du lot) : le `if (!session) return 401`
  // écrit dans app/api/evaluations/route.ts (GET) est, en pratique,
  // INATTEIGNABLE — middleware.ts protège déjà "/api/evaluations" via
  // SHARED_PREFIXES (config.matcher inclut "/api/evaluations/:path*") et
  // renvoie 403 "Accès non autorisé" AVANT même d'atteindre le handler dès
  // qu'aucun cookie de session valide n'est présent (voir
  // middleware.ts::redirectToLogin, appelé si `!token`). Vérifié ici avec
  // un contexte HTTP explicitement isolé (jamais le fixture `request`
  // partagé, pour exclure toute session héritée d'un test précédent) —
  // comportement RÉEL verrouillé tel quel, jamais l'hypothèse de lecture
  // du seul fichier route.ts.
  test("GET non authentifié -> 403 (bloqué par middleware.ts avant d'atteindre la route ; son propre 401 interne est inatteignable)", async () => {
    const contexteIsole = await apiRequest.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    try {
      const reponse = await contexteIsole.get("/api/evaluations");
      expect(reponse.status()).toBe(403);
    } finally {
      await contexteIsole.dispose();
    }
  });
});
