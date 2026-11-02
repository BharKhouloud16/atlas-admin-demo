import { test, expect, type APIRequestContext } from "@playwright/test";
import { creerClientIsole, creerProfilIsole, connecter } from "../setup/donnees-isolees";
import { prisma } from "@/lib/prisma";

// REV-02 (01/11/2026) — page Talents : affichage en LECTURE SEULE,
// recherche mémorisée (y compris sans résultat), invalidation quand le
// besoin ou le vivier de profils change, aucune nouvelle vague si le
// résultat recalculé est identique. Données isolées (compétence unique par
// test : seuls les profils créés ici peuvent correspondre).

type Suivi = { besoinId: string; etatRecherche: string; profils: { cle: string; libelle: string }[] };

async function suivi(request: APIRequestContext, needId: string): Promise<Suivi> {
  const r = await request.get("/api/client/talents");
  expect(r.ok()).toBeTruthy();
  return (await r.json()).besoins.find((b: Suivi) => b.besoinId === needId);
}

async function actualiser(request: APIRequestContext, needId: string): Promise<Suivi> {
  const r = await request.post("/api/client/talents/actualiser", { data: { needIds: [needId] } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).besoins.find((b: Suivi) => b.besoinId === needId);
}

const compter = async (needId: string) => ({
  vagues: await prisma.solutionVague.count({ where: { needId } }),
  options: await prisma.solutionOption.count({ where: { needId } }),
});

test.describe("REV-02 — recherche de profils mémorisée", () => {
  test("cycle complet : sans résultat mémorisé, invalidation par le vivier, résultat identique conservé, invalidation par le besoin", async ({ request }) => {
    const c = await creerClientIsole({ contractualisation: true });
    const competence = `RevComp${c.suffixe}`;
    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: c.client.id,
        correlationId: `rev02-${c.suffixe}`,
        texteOriginal: `Besoin REV-02 ${c.suffixe}`,
        statut: "VALIDE",
        faits: { create: [{ cle: "COMPETENCE", valeur: competence, statut: "DECLARE" }] },
      },
    });
    await connecter(request, c.email);

    // 1. Jamais recherché : l'affichage ne calcule rien.
    expect((await suivi(request, besoin.id)).etatRecherche).toBe("A_ACTUALISER");
    expect(await compter(besoin.id)).toEqual({ vagues: 0, options: 0 });

    // 2. Recherche sans résultat : MÉMORISÉE, plus jamais relancée à l'affichage.
    const vide = await actualiser(request, besoin.id);
    expect(vide).toMatchObject({ etatRecherche: "A_JOUR", profils: [] });
    expect(await compter(besoin.id)).toEqual({ vagues: 1, options: 0 });
    for (let i = 0; i < 3; i++) expect((await suivi(request, besoin.id)).etatRecherche).toBe("A_JOUR");
    await actualiser(request, besoin.id); // déjà à jour : aucun recalcul
    expect(await compter(besoin.id)).toEqual({ vagues: 1, options: 0 });

    // 3. Le vivier change (un profil correspondant apparaît) : recherche à actualiser.
    await creerProfilIsole([competence]);
    expect((await suivi(request, besoin.id)).etatRecherche).toBe("A_ACTUALISER");
    const trouve = await actualiser(request, besoin.id);
    expect(trouve.etatRecherche).toBe("A_JOUR");
    expect(trouve.profils).toHaveLength(1);
    const apresTrouve = await compter(besoin.id);
    expect(apresTrouve.vagues).toBe(2);

    // 4. Le vivier change sans effet sur ce besoin : même résultat, AUCUNE nouvelle option.
    await creerProfilIsole([`AutreComp${c.suffixe}`]);
    expect((await suivi(request, besoin.id)).etatRecherche).toBe("A_ACTUALISER");
    const identique = await actualiser(request, besoin.id);
    expect(identique.profils.map((p) => p.cle)).toEqual(trouve.profils.map((p) => p.cle));
    expect(await compter(besoin.id)).toEqual({ vagues: 3, options: apresTrouve.options });

    // 5. Le besoin change (nouveau critère) : recherche à actualiser.
    await prisma.clientNeedFait.create({ data: { needId: besoin.id, cle: "SENIORITE", valeur: "Senior", statut: "DECLARE" } });
    expect((await suivi(request, besoin.id)).etatRecherche).toBe("A_ACTUALISER");
    expect((await actualiser(request, besoin.id)).etatRecherche).toBe("A_JOUR");
  });

  test("affichage répété de la page : aucune écriture, quel que soit le nombre de besoins", async ({ request }) => {
    const c = await creerClientIsole();
    for (let i = 0; i < 8; i++) {
      await prisma.clientNeed.create({
        data: {
          clientId: c.client.id,
          correlationId: `rev02-n${i}-${c.suffixe}`,
          texteOriginal: `Besoin ${i}`,
          statut: "VALIDE",
          faits: { create: [{ cle: "COMPETENCE", valeur: `RevAbsente${i}${c.suffixe}`, statut: "DECLARE" }] },
        },
      });
    }
    await connecter(request, c.email);
    const avant = await prisma.solutionVague.count({ where: { clientId: c.client.id } });
    for (let i = 0; i < 3; i++) {
      const r = await request.get("/api/client/talents");
      expect(r.ok()).toBeTruthy();
      expect((await r.json()).besoins).toHaveLength(8);
    }
    expect(await prisma.solutionVague.count({ where: { clientId: c.client.id } })).toBe(avant);
    expect(await prisma.solutionOption.count({ where: { clientId: c.client.id } })).toBe(0);
  });

  test("actualisation : 5 besoins au plus par appel, besoins d'un autre client ignorés", async ({ request }) => {
    const a = await creerClientIsole();
    const b = await creerClientIsole();
    const besoinB = await prisma.clientNeed.create({ data: { clientId: b.client.id, correlationId: `rev02-b-${b.suffixe}`, texteOriginal: "Besoin B", statut: "VALIDE" } });
    await connecter(request, a.email);
    expect((await request.post("/api/client/talents/actualiser", { data: { needIds: ["1", "2", "3", "4", "5", "6"] } })).status()).toBe(400);
    const r = await request.post("/api/client/talents/actualiser", { data: { needIds: [besoinB.id] } });
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).besoins).toEqual([]);
    expect(await prisma.solutionVague.count({ where: { needId: besoinB.id } })).toBe(0);
  });

  test("le besoin d'un projet n'apparaît pas dans Talents", async ({ request }) => {
    const c = await creerClientIsole({ qualification: true });
    await connecter(request, c.email);
    const r = await request.post("/api/client/projets", { data: { type: "DELIVERY", titre: "Projet hors Talents", objectif: "o", resultatAttendu: "r" } });
    const projet = await prisma.projet.findUniqueOrThrow({ where: { id: (await r.json()).id } });
    await prisma.clientNeed.update({ where: { id: projet.needId }, data: { statut: "VALIDE" } });
    const besoins = (await (await request.get("/api/client/talents")).json()).besoins as Suivi[];
    expect(besoins.find((x) => x.besoinId === projet.needId)).toBeUndefined();
  });
});
