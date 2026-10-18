import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS LOT 16.3 — MISSION LIST SCALABILITY (30/09/2026).
//
// Couvre exclusivement la pagination de GET /api/missions (page/pageSize),
// introduite pour remplacer le payload complet (~4.8 Mo pour 2868+ missions
// à l'écriture de ce lot) par une liste découpée côté serveur — voir
// app/api/missions/route.ts (normaliserPagination) et
// app/admin/missions/page.tsx (seul consommateur UI réel, confirmé par
// cartographie exhaustive avant implémentation).
//
// Discipline de ces tests : la base de test partagée accumule des milliers
// de missions au fil de tout l'engagement (non réinitialisée entre lots,
// règle fondateur) — aucun test ci-dessous ne suppose un total ou un
// contenu de page fixe. Les vérifications structurelles (tri, absence de
// duplication, total, totalPages) comparent la réponse HTTP à une requête
// Prisma directe avec exactement les mêmes paramètres (where/orderBy/skip/
// take), jamais à une valeur codée en dur. L'isolation Ingénieur utilise un
// compte de test dédié et fraîchement créé (jamais le compte partagé
// "Ingénieur Démo", dont le volume de missions accumulées est imprévisible)
// pour garder un total exact et connu.

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

async function creerMissionsTest(n: number, prefix: string) {
  const client = await prisma.client.findFirst();
  const profil = await prisma.profil.create({ data: { nom: `${prefix}-profil-${Date.now()}-${Math.random()}` } });
  if (!client) throw new Error("aucun client en base — seed manquant");
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, repere: `${prefix}-${i}`, nbJours: 1, tjmVente: 100 },
    });
    ids.push(m.id);
  }
  return { profil, ids };
}

test.describe("ATLAS LOT 16.3 — GET /api/missions — pagination (structure & tri)", () => {
  test("1. page 1 par défaut (aucun paramètre) : forme {items,total,page,pageSize,totalPages}, pageSize=20", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/missions");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.page).toBe(1);
    expect(corps.pageSize).toBe(20);
    expect(Array.isArray(corps.items)).toBeTruthy();
    expect(corps.items.length).toBeLessThanOrEqual(20);
    expect(typeof corps.total).toBe("number");
    expect(corps.total).toBeGreaterThan(0);
    expect(corps.totalPages).toBe(Math.max(1, Math.ceil(corps.total / corps.pageSize)));
  });

  test("2. page suivante (page=2) : contenu distinct de la page 1, aligné sur un skip direct en base", async () => {
    let request = await connecter("ADMIN");
    const pageSize = 5;
    const p1 = await (await request.get(`/api/missions?page=1&pageSize=${pageSize}`)).json();
    const p2 = await (await request.get(`/api/missions?page=2&pageSize=${pageSize}`)).json();

    const idsAttendus = (
      await prisma.mission.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: pageSize,
        take: pageSize,
        select: { id: true },
      })
    ).map((m) => m.id);

    expect(p2.items.map((m: { id: string }) => m.id)).toEqual(idsAttendus);
    const idsP1 = new Set(p1.items.map((m: { id: string }) => m.id));
    for (const id of idsAttendus) expect(idsP1.has(id)).toBeFalsy();
  });

  test("3. dernière page : jamais vide quand total > 0, jamais plus de pageSize éléments", async () => {
    let request = await connecter("ADMIN");
    const pageSize = 7;
    const premiere = await (await request.get(`/api/missions?page=1&pageSize=${pageSize}`)).json();
    const derniere = await (await request.get(`/api/missions?page=${premiere.totalPages}&pageSize=${pageSize}`)).json();
    expect(derniere.items.length).toBeGreaterThan(0);
    expect(derniere.items.length).toBeLessThanOrEqual(pageSize);
  });

  test("4. page hors limites (au-delà de la dernière page) : 200, items vide, jamais une erreur", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/missions?page=999999&pageSize=20");
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();
    expect(corps.items).toEqual([]);
    expect(corps.page).toBe(999999);
    expect(corps.total).toBeGreaterThan(0);
  });

  test("5. pageSize invalide (non numérique, zéro, négatif) : retombe silencieusement sur la valeur par défaut (20), jamais une erreur 400", async () => {
    let request = await connecter("ADMIN");
    for (const valeur of ["abc", "0", "-5", ""]) {
      const reponse = await request.get(`/api/missions?pageSize=${encodeURIComponent(valeur)}`);
      expect(reponse.status(), `pageSize=${valeur}`).toBe(200);
      const corps = await reponse.json();
      expect(corps.pageSize, `pageSize=${valeur}`).toBe(20);
    }
  });

  test("6. pageSize excessif : plafonné à 100, jamais le volume brut demandé", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.get("/api/missions?pageSize=999999");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.pageSize).toBe(100);
    expect(corps.items.length).toBeLessThanOrEqual(100);
  });

  test("7. total correspond exactement au compte réel en base (Admin voit toutes les missions, sans filtre)", async () => {
    let request = await connecter("ADMIN");
    const corps = await (await request.get("/api/missions?pageSize=1")).json();
    const totalReel = await prisma.mission.count();
    expect(corps.total).toBe(totalReel);
  });

  test("8. totalPages = ceil(total / pageSize), vérifié pour plusieurs tailles de page", async () => {
    let request = await connecter("ADMIN");
    for (const pageSize of [10, 33, 100]) {
      const corps = await (await request.get(`/api/missions?pageSize=${pageSize}`)).json();
      expect(corps.totalPages).toBe(Math.max(1, Math.ceil(corps.total / pageSize)));
    }
  });

  test("9. aucune duplication entre pages consécutives (départageur id garantit un tri strictement unique)", async () => {
    let request = await connecter("ADMIN");
    const pageSize = 4;
    const p1 = await (await request.get(`/api/missions?page=1&pageSize=${pageSize}`)).json();
    const p2 = await (await request.get(`/api/missions?page=2&pageSize=${pageSize}`)).json();
    const p3 = await (await request.get(`/api/missions?page=3&pageSize=${pageSize}`)).json();
    const tousLesIds = [...p1.items, ...p2.items, ...p3.items].map((m: { id: string }) => m.id);
    expect(new Set(tousLesIds).size).toBe(tousLesIds.length);
  });

  test("10. tri strictement déterministe : deux appels identiques renvoient exactement le même ordre", async () => {
    let request = await connecter("ADMIN");
    const a = await (await request.get("/api/missions?page=1&pageSize=15")).json();
    const b = await (await request.get("/api/missions?page=1&pageSize=15")).json();
    expect(a.items.map((m: { id: string }) => m.id)).toEqual(b.items.map((m: { id: string }) => m.id));
  });
});

test.describe("ATLAS LOT 16.3 — GET /api/missions — permissions & isolation (pagination ne les modifie jamais)", () => {
  test("11. CLIENT reste refusé (403) quels que soient page/pageSize fournis — la pagination ne contourne jamais le RBAC en amont", async () => {
    let request = await connecter("CLIENT");
    for (const qs of ["", "?page=1&pageSize=5", "?page=999&pageSize=100"]) {
      const reponse = await request.get(`/api/missions${qs}`);
      expect(reponse.status(), qs).toBe(403);
    }
  });

  test("12. isolation INGENIEUR inchangée : total exact = ses seules missions, jamais une mission d'un autre profil même en manipulant page/pageSize", async ({}) => {
    const { profil: profilA, ids: idsA } = await creerMissionsTest(3, "LOT163-ISO-A");
    const { ids: idsB } = await creerMissionsTest(5, "LOT163-ISO-B");

    const email = `ing-lot163-iso-${Date.now()}@test.local`;
    await prisma.user.create({
      data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profilA.id, emailVerifie: true },
    });
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profilA.id });

    try {
      // total doit être exactement 3 (ses propres missions), jamais 8
      // (contamination avec le profil B) ni 0 (sur-filtrage).
      const p1 = await (await ctx.get("/api/missions")).json();
      expect(p1.total).toBe(3);

      // Manipulation page/pageSize : jamais une mission du profil B ne doit
      // apparaître, quelle que soit la fenêtre demandée.
      const large = await (await ctx.get("/api/missions?page=1&pageSize=100")).json();
      const idsRenvoyes = large.items.map((m: { id: string }) => m.id);
      expect(idsRenvoyes.sort()).toEqual([...idsA].sort());
      for (const idInterdit of idsB) expect(idsRenvoyes).not.toContain(idInterdit);

      // Page au-delà de son propre total : vide, jamais une fuite d'une
      // page suivante appartenant à un autre profil.
      const horsBornes = await (await ctx.get("/api/missions?page=2&pageSize=100")).json();
      expect(horsBornes.items).toEqual([]);
      expect(horsBornes.total).toBe(3);
    } finally {
      await ctx.dispose();
    }
  });
});
