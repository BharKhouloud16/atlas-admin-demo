import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// ATLAS TALENT — Observabilité & Security Intelligence interne (B17,
// 08/09/2026). Couvre le chapitre "tests" de la directive B17 pour les
// changements réels de ce lot :
// - RBAC vertical/horizontal désormais OBSERVABLE sur /api/missions et
//   /api/clients (avant B17, ces refus existaient déjà côté route mais
//   étaient inatteignables pour Client/Ingénieur, bloqués en amont par le
//   middleware — voir middleware.ts, FIX B17 — donc jamais journalisés) ;
// - isolation inter-client / BOLA sur /api/feuilles-de-temps (PATCH
//   validerClient), déjà protégée depuis B13, journalisée depuis B17 ;
// - nouvel événement "objet.consultation" (SUCCES) sur la lecture la plus
//   sensible du produit (marge-intelligence, coûts/marge internes) ;
// - nouveau signal calculé "acces_anormal_objets" (lib/security/
//   runtime-signals.ts), qui passe d'UNKNOWN à un vrai calcul maintenant
//   que sa source de donnée existe réellement (directive B17, section 3 :
//   ne jamais transformer UNKNOWN en détection artificielle — ici la
//   donnée existe, ce n'est pas une invention) ;
// - absence de fuite de secret/PII dans les nouveaux champs journalisés.
//
// Ce fichier ne retouche à aucune route métier existante et ne crée que
// des fixtures jetables (missions/clients de test), même convention que
// tests/api/facturation-devise.spec.ts — pas de nettoyage requis, la base
// de test est réinitialisée entre les runs CI.

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

async function idProfilIngenieurDemo(request: APIRequestContext): Promise<string> {
  const reponse = await request.get("/api/profils");
  expect(reponse.ok()).toBeTruthy();
  const { profils } = await reponse.json();
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

async function idMissionSeed(): Promise<string> {
  // LOT 16.3 — GET /api/missions est désormais paginé (page=1&pageSize=20
  // par défaut) : la mission de seed "Audit Q4 2026" n'est plus garantie
  // d'apparaître sur la première page vu le volume de missions accumulées
  // en base de test. Cette fonction n'a besoin que d'un identifiant de
  // fixture valide, jamais d'exercer le comportement de la liste paginée —
  // lookup direct en base, sans round-trip HTTP.
  const mission = await prisma.mission.findFirst({ where: { repere: "Audit Q4 2026" } });
  expect(mission, "la mission de démo 'Audit Q4 2026' devrait exister (voir prisma/seed.ts)").toBeTruthy();
  return mission!.id;
}

// Cherche, côté Admin, un événement récent correspondant — la fenêtre
// `depuis` (ms epoch, capturé juste avant l'action testée) évite les faux
// positifs sous exécution CI parallèle (plusieurs suites génèrent des
// rbac.acces_refuse en même temps, voir le commentaire équivalent dans
// app/api/security/evenements/route.ts, ajouté en B16 pour la même raison).
async function evenementRecent(
  request: APIRequestContext,
  params: { action: string; resultat: string; acteurEmail: string; depuis: number }
): Promise<Record<string, unknown> | undefined> {
  request = await connecter("ADMIN");
  const qs = new URLSearchParams({
    action: params.action,
    resultat: params.resultat,
    acteurEmail: params.acteurEmail,
    limite: "30",
  });
  const reponse = await request.get(`/api/security/evenements?${qs.toString()}`);
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
  const { evenements } = await reponse.json();
  return (evenements as Array<Record<string, unknown>>).find(
    (e) => new Date(e.createdAt as string).getTime() >= params.depuis - 2000
  );
}

test.describe("B17 — traçabilité RBAC désormais atteignable (/api/missions, /api/clients)", () => {
  test("Client sur GET /api/missions : 403 + événement rbac.acces_refuse journalisé (ressourceType Mission)", async () => {
    const avant = Date.now();
    let request = await connecter("CLIENT");
    const refus = await request.get("/api/missions");
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "client-demo@example.com",
      depuis: avant,
    });
    expect(evt, "un événement rbac.acces_refuse aurait dû être journalisé pour ce refus (mort-code corrigé par le FIX B17 dans middleware.ts)").toBeTruthy();
    expect(evt?.ressourceType).toBe("Mission");
    expect(evt?.contexteRoute).toBe("/api/missions");
  });

  test("Client sur POST /api/missions : 403 + événement journalisé", async () => {
    const avant = Date.now();
    let request = await connecter("CLIENT");
    const refus = await request.post("/api/missions", { data: {} });
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "client-demo@example.com",
      depuis: avant,
    });
    expect(evt).toBeTruthy();
    expect(evt?.contexteRoute).toBe("/api/missions");
  });

  test("Client sur GET /api/clients : 403 + événement journalisé (ressourceType Client)", async () => {
    const avant = Date.now();
    let request = await connecter("CLIENT");
    const refus = await request.get("/api/clients");
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "client-demo@example.com",
      depuis: avant,
    });
    expect(evt, "un événement rbac.acces_refuse aurait dû être journalisé (mort-code corrigé par le FIX B17)").toBeTruthy();
    expect(evt?.ressourceType).toBe("Client");
  });

  test("Ingénieur sur GET /api/clients : 403 + événement journalisé (horizontal, rôle différent)", async () => {
    const avant = Date.now();
    let request = await connecter("INGENIEUR");
    const refus = await request.get("/api/clients");
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "ingenieur-demo@example.com",
      depuis: avant,
    });
    expect(evt).toBeTruthy();
    expect(evt?.ressourceType).toBe("Client");
  });

  test("Ingénieur sur POST /api/clients : 403 + événement journalisé", async () => {
    const avant = Date.now();
    let request = await connecter("INGENIEUR");
    const refus = await request.post("/api/clients", { data: { nom: "Ne devrait jamais être créé" } });
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "ingenieur-demo@example.com",
      depuis: avant,
    });
    expect(evt).toBeTruthy();
  });

  test("non-régression : un Admin peut toujours utiliser /api/missions et /api/clients normalement", async () => {
    let request = await connecter("ADMIN");
    const [rMissions, rClients] = await Promise.all([request.get("/api/missions"), request.get("/api/clients")]);
    expect(rMissions.ok(), await rMissions.text()).toBeTruthy();
    expect(rClients.ok(), await rClients.text()).toBeTruthy();
  });
});

test.describe("B17 — isolation inter-client / BOLA (feuilles-de-temps)", () => {
  test("un Client ne peut jamais valider la feuille de temps d'un AUTRE client : 403 + événement avec ressourceId", async () => {
    // Fixture jetable : un second Client (sans compte utilisateur associé,
    // seul le clientId compte pour reproduire l'écart d'isolation), une
    // mission pour ce client, un CRA soumis puis validé Admin.
    let request = await connecter("ADMIN");
    const profilId = await idProfilIngenieurDemo(request);

    const creationClient = await request.post("/api/clients", { data: { nom: "Client BOLA Test B17" } });
    expect(creationClient.status(), await creationClient.text()).toBe(201);
    const autreClient = await creationClient.json();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: autreClient.id, profilId, nbJours: 5, tjmVente: 500 },
    });
    expect(creationMission.status(), await creationMission.text()).toBe(201);
    const mission = await creationMission.json();

    request = await connecter("INGENIEUR");
    const soumission = await request.post("/api/feuilles-de-temps", {
      data: { missionId: mission.id, mois: "2099-01", joursTravailles: 5, heuresSupplementaires: 0, soumettre: true },
    });
    expect(soumission.status(), await soumission.text()).toBe(201);
    const feuille = await soumission.json();

    request = await connecter("ADMIN");
    const validationAdmin = await request.patch("/api/feuilles-de-temps", {
      data: { id: feuille.id, action: "validerAdmin" },
    });
    expect(validationAdmin.ok(), await validationAdmin.text()).toBeTruthy();

    // client-demo (compte de démo existant) n'a AUCUN rapport avec
    // "Client BOLA Test B17" : sa tentative de validation doit être
    // refusée par isolation inter-client, pas par un simple refus de rôle.
    const avant = Date.now();
    request = await connecter("CLIENT");
    const refusBola = await request.patch("/api/feuilles-de-temps", {
      data: { id: feuille.id, action: "validerClient" },
    });
    expect(refusBola.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "client-demo@example.com",
      depuis: avant,
    });
    expect(evt, "l'isolation inter-client (BOLA) sur les feuilles de temps aurait dû être journalisée").toBeTruthy();
    expect(evt?.ressourceType).toBe("FeuilleDeTemps");
    expect(evt?.ressourceId).toBe(feuille.id);
  });
});

test.describe("B17 — instrumentation des lectures sensibles (marge-intelligence)", () => {
  test("une lecture Admin réussie de marge-intelligence journalise objet.consultation (SUCCES)", async () => {
    const avant = Date.now();
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();
    const lecture = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(lecture.ok(), await lecture.text()).toBeTruthy();

    const evt = await evenementRecent(request, {
      action: "objet.consultation",
      resultat: "SUCCES",
      acteurEmail: "admin-demo@example.com",
      depuis: avant,
    });
    expect(evt, "la lecture réussie de marge-intelligence aurait dû journaliser objet.consultation").toBeTruthy();
    expect(evt?.ressourceType).toBe("Mission");
    expect(evt?.ressourceId).toBe(missionId);
  });

  test("un refus (Client) sur marge-intelligence journalise rbac.acces_refuse avec le ressourceId de la mission", async () => {
    const avant = Date.now();
    let request = await connecter("ADMIN");
    const missionId = await idMissionSeed();

    request = await connecter("CLIENT");
    const refus = await request.get(`/api/missions/${missionId}/marge-intelligence`);
    expect(refus.status()).toBe(403);

    const evt = await evenementRecent(request, {
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      acteurEmail: "client-demo@example.com",
      depuis: avant,
    });
    expect(evt).toBeTruthy();
    expect(evt?.ressourceType).toBe("Mission");
    expect(evt?.ressourceId).toBe(missionId);
  });
});

test.describe("B17 — signal calculé « accès anormal à des objets » (bout en bout)", () => {
  test("20 lectures d'objets distincts par le même acteur déclenchent le signal acces_anormal_objets (plus UNKNOWN)", async () => {
    test.setTimeout(60_000);
    let request = await connecter("ADMIN");
    const clientId = await idPremierClient(request);
    const profilId = await idProfilIngenieurDemo(request);

    const SEUIL = 20;
    const missionIds: string[] = [];
    for (let i = 0; i < SEUIL; i++) {
      const creation = await request.post("/api/missions", {
        data: { clientId, profilId, nbJours: 1, tjmVente: 100, repere: `B17 signal test ${i}` },
      });
      expect(creation.status(), await creation.text()).toBe(201);
      const mission = await creation.json();
      missionIds.push(mission.id);
    }

    for (const id of missionIds) {
      const lecture = await request.get(`/api/missions/${id}/marge-intelligence`);
      expect(lecture.ok(), await lecture.text()).toBeTruthy();
    }

    const reponse = await request.get("/api/security/runtime");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { signaux } = await reponse.json();
    const signal = (signaux as Array<{ regle: string; statut: string; fait: string }>).find(
      (s) => s.regle === "acces_anormal_objets"
    );
    expect(signal, "le signal acces_anormal_objets devrait toujours être présent (même à AUCUN_SIGNAL par défaut)").toBeTruthy();
    // Avec >= 20 objets Mission distincts lus par admin-demo dans les 15
    // dernières minutes, le signal doit être détecté — jamais UNKNOWN :
    // sa source de donnée (objet.consultation) existe désormais réellement
    // (directive B17, section 3).
    expect(signal?.statut).toBe("SIGNAL_DETECTE");
    expect(signal?.fait).toContain("admin-demo@example.com");
  });
});

test.describe("B17 — absence de fuite de secret/PII dans les nouveaux champs journalisés", () => {
  test("les événements rbac.acces_refuse et objet.consultation de ce lot ne contiennent ni secret, ni mot de passe, ni jeton", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/security/evenements?limite=100");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const { evenements } = await reponse.json();
    const texte = JSON.stringify(evenements);
    for (const motif of ["password", "motDePasse", "token", "jeton", "secret", "Bearer "]) {
      expect(texte, `${motif} ne devrait jamais apparaître dans les événements de sécurité`).not.toContain(motif);
    }
  });
});
