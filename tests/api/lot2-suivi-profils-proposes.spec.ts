import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { creerClientIsole, connecter } from "../setup/donnees-isolees";

// LOT 2 (28/10/2026) — Espace Talents : profils proposés (anonymes) pour un
// besoin validé, comparaison, poursuite, refus, demande d'autres profils,
// traitement Admin. Exigences : au plus 5 profils réellement admissibles,
// aucune identité exposée au Client, aucune mission créée automatiquement,
// isolation entre clients.

// REV-03 (01/11/2026) : chaque test crée son propre client (profil
// entreprise complet, fictif) et des compétences UNIQUES : aucun compte de
// démonstration modifié, aucun profil d'un autre test ne peut correspondre.

function marqueur() {
  return `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

async function creerCandidat(competence: string, suffixe: string, extra: { declarees?: string[] } = {}) {
  return prisma.profil.create({
    data: {
      nom: `NomSecret${suffixe}`,
      prenom: `PrenomSecret${suffixe}`,
      cvValide: true,
      competences: [competence, ...(extra.declarees ?? [])],
      competencesGraph: {
        create: [
          { competence, statut: "VERIFIE", confiance: "HAUTE" },
          ...(extra.declarees ?? []).map((c) => ({ competence: c, statut: "DECLARE" as const, confiance: "MOYENNE" as const })),
        ],
      },
      seniorite: "Senior",
      anneesExperience: 7,
      tjmEstime: 777,
      disponibilite: "Disponible immédiatement",
    },
  });
}

async function besoinValide(clientId: string, competence: string, suffixe: string) {
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `lot2-${suffixe}`,
      titre: `Besoin lot2 ${suffixe}`,
      texteOriginal: `Besoin lot2 ${suffixe}`,
      statut: "VALIDE",
      faits: { create: [{ cle: "COMPETENCE", valeur: competence, statut: "DECLARE", source: "extraction" }] },
    },
  });
}

// Parcours réel de la page Talents (REV-02) : affichage en lecture seule,
// puis actualisation du besoin si sa recherche n'est pas à jour.
async function suiviPour(request: APIRequestContext, besoinId: string) {
  const reponse = await request.get("/api/client/talents");
  expect(reponse.status()).toBe(200);
  let texte = await reponse.text();
  let bloc = JSON.parse(texte).besoins.find((b: { besoinId: string }) => b.besoinId === besoinId);
  if (bloc && bloc.etatRecherche === "A_ACTUALISER") {
    const maj = await request.post("/api/client/talents/actualiser", { data: { needIds: [besoinId] } });
    expect(maj.status(), await maj.text()).toBe(200);
    texte = await maj.text();
    bloc = JSON.parse(texte).besoins.find((b: { besoinId: string }) => b.besoinId === besoinId);
  }
  return { texte, bloc };
}

async function clientEtConnexion(request: APIRequestContext) {
  const c = await creerClientIsole({ contractualisation: true });
  await connecter(request, c.email);
  return c;
}

test.describe("LOT 2 — accès", () => {
  test("non authentifié -> 403 ; Ingénieur -> 403 ; Client -> actions Admin refusées", async ({ request }) => {
    expect((await request.get("/api/client/talents")).status()).toBe(403);
    expect((await request.post("/api/client/talents/actualiser", { data: { needIds: ["x"] } })).status()).toBe(403);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/client/talents")).status()).toBe(403);
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `Comp${marqueur()}`, marqueur());
    expect((await request.get(`/api/talent/besoins/${besoin.id}/actions-client`)).status()).toBe(403);
  });
});

test.describe("LOT 2 — profils proposés", () => {
  test("au plus 5 profils admissibles, libellés anonymes, aucune donnée d'identité ni tarif", async ({ request }) => {
    const s = marqueur();
    const competence = `Comp${s}`;
    for (let i = 0; i < 7; i++) await creerCandidat(competence, `${s}x${i}`);
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, competence, s);

    const { texte, bloc } = await suiviPour(request, besoin.id);
    expect(bloc.eligible).toBe(true);
    // 7 profils admissibles : exactement 5 proposés (limite stricte).
    expect(bloc.profils).toHaveLength(5);
    expect(bloc.profils.map((p: { libelle: string }) => p.libelle)).toEqual(["Profil A", "Profil B", "Profil C", "Profil D", "Profil E"]);
    for (const interdit of [`NomSecret${s}`, `PrenomSecret${s}`, "profilId", "tjm"]) {
      expect(texte).not.toContain(interdit);
    }
    // Le TJM du candidat (777) n'apparaît comme valeur nulle part.
    expect(texte).not.toMatch(/[^a-z0-9]777[^a-z0-9]/i);
  });

  test("shortlist VALIDÉE par l'Admin : visible et anonyme, seules les compétences vérifiées ; une entrée SUGGÉRÉE reste invisible", async ({ request }) => {
    const s = marqueur();
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `CompAbsente${s}`, s);
    const declaree = `CompetenceDeclaree${s}`;
    const valide = await creerCandidat(`CompEquipe${s}`, `${s}v`, { declarees: [declaree] });
    const suggere = await creerCandidat(`CompEquipe${s}`, `${s}s`);
    const demande = await prisma.demandeTalent.create({
      data: { clientId: c.client.id, description: `Demande lot2 ${s}`, sourceNeedId: besoin.id, statut: "SHORTLIST_ENVOYEE" },
    });
    await prisma.shortlistEntree.create({ data: { demandeId: demande.id, profilId: valide.id, score: 80, confiance: 0.8, motifs: [], statut: "VALIDEE" } });
    await prisma.shortlistEntree.create({ data: { demandeId: demande.id, profilId: suggere.id, score: 70, confiance: 0.7, motifs: [], statut: "SUGGEREE" } });

    const { texte, bloc } = await suiviPour(request, besoin.id);
    const equipe = bloc.profils.filter((p: { origine: string }) => p.origine === "EQUIPE_ATLAS");
    expect(equipe).toHaveLength(1);
    expect(equipe[0].competencesCorrespondantes).toEqual([`CompEquipe${s}`]);
    expect(equipe[0].seniorite).toBe("Senior");
    expect(texte).not.toContain(declaree);
    expect(texte).not.toContain(valide.id);
    expect(texte).not.toContain(`NomSecret${s}`);
  });

  test("limite stricte : shortlist + matching plafonnés à 5, un même ingénieur jamais proposé deux fois", async ({ request }) => {
    const s = marqueur();
    const competence = `CompMix${s}`;
    const candidats = [];
    for (let i = 0; i < 4; i++) candidats.push(await creerCandidat(competence, `${s}m${i}`));
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, competence, s);
    const demande = await prisma.demandeTalent.create({ data: { clientId: c.client.id, description: `Demande ${s}`, sourceNeedId: besoin.id, statut: "SHORTLIST_ENVOYEE" } });
    // Deux entrées validées par l'équipe dont UNE est aussi trouvée par le matching.
    const autre = await creerCandidat(`CompAutre${s}`, `${s}e`);
    await prisma.shortlistEntree.create({ data: { demandeId: demande.id, profilId: candidats[0].id, score: 90, confiance: 0.9, motifs: [], statut: "VALIDEE" } });
    await prisma.shortlistEntree.create({ data: { demandeId: demande.id, profilId: autre.id, score: 85, confiance: 0.9, motifs: [], statut: "VALIDEE" } });

    const { bloc } = await suiviPour(request, besoin.id);
    // 2 (équipe) + 4 (matching) - 1 doublon = 5 profils distincts, équipe en premier.
    expect(bloc.profils).toHaveLength(5);
    expect(bloc.profils.slice(0, 2).map((p: { origine: string }) => p.origine)).toEqual(["EQUIPE_ATLAS", "EQUIPE_ATLAS"]);
    // Un 5e candidat du matching : la limite reste 5 ; un profil non affiché ne peut pas faire l'objet d'une décision.
    await creerCandidat(competence, `${s}m4`);
    const apres = (await suiviPour(request, besoin.id)).bloc;
    expect(apres.profils).toHaveLength(5);
    const optionsVague = await prisma.solutionVague.findFirst({ where: { needId: besoin.id }, orderBy: { createdAt: "desc" } });
    const affichees = new Set(apres.profils.map((p: { cle: string }) => p.cle));
    const cachee = optionsVague!.optionIds.find((id) => !affichees.has(id) && id);
    const optionCachee = cachee ? await prisma.solutionOption.findUnique({ where: { id: cachee } }) : null;
    if (optionCachee && optionCachee.niveau === "OPTION") {
      const refus = await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", solutionOptionId: optionCachee.id } });
      expect(refus.status()).toBe(404);
    }
  });

  test("besoin d'un autre client : jamais renvoyé", async ({ request }) => {
    const s = marqueur();
    const autre = await prisma.client.create({ data: { nom: `Autre client lot2 ${s}` } });
    const besoin = await besoinValide(autre.id, `Comp${s}`, s);
    await clientEtConnexion(request);
    const { bloc } = await suiviPour(request, besoin.id);
    expect(bloc).toBeUndefined();
  });
});

test.describe("LOT 2 — actions du Client et traitement Admin", () => {
  test("poursuivre : tracé, une seule décision ouverte par profil, aucune mission créée", async ({ request }) => {
    const s = marqueur();
    await creerCandidat(`Comp${s}`, s);
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `Comp${s}`, s);
    const { bloc } = await suiviPour(request, besoin.id);
    const profil = bloc.profils[0];
    const missionsAvant = await prisma.mission.count({ where: { clientId: c.client.id } });

    const p1 = await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", ...profil.cible } });
    expect(p1.status()).toBe(201);
    expect((await suiviPour(request, besoin.id)).bloc.profils[0].derniereAction).toMatchObject({ type: "POURSUIVRE", statut: "ENVOYEE" });

    // Décision ouverte : ni doublon ni décision contradictoire.
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", ...profil.cible } })).status()).toBe(409);
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "NE_PAS_RETENIR", ...profil.cible } })).status()).toBe(409);

    // Une fois traitée par l'équipe, le Client peut changer d'avis.
    await prisma.actionTalentClient.update({ where: { id: (await p1.json()).id }, data: { statut: "CLOTUREE" } });
    const p2 = await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "NE_PAS_RETENIR", ...profil.cible } });
    expect(p2.status()).toBe(201);
    expect((await suiviPour(request, besoin.id)).bloc.profils[0].derniereAction).toMatchObject({ type: "NE_PAS_RETENIR" });

    expect(await prisma.mission.count({ where: { clientId: c.client.id } })).toBe(missionsAvant);
    expect(await prisma.actionTalentClient.count({ where: { needId: besoin.id } })).toBe(2);
  });

  test("demander d'autres profils : une seule demande ouverte à la fois, même sur requêtes simultanées", async ({ request }) => {
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `Comp${marqueur()}`, marqueur());
    const reponses = await Promise.all(
      Array.from({ length: 4 }, () => request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "AUTRES_PROFILS", commentaire: "Plus d'expérience cloud" } }))
    );
    expect(reponses.map((r) => r.status()).sort()).toEqual([201, 409, 409, 409]);
    expect(await prisma.actionTalentClient.count({ where: { needId: besoin.id, type: "AUTRES_PROFILS" } })).toBe(1);
  });

  test("cibles invalides : option d'un autre besoin (404), besoin non validé (409), deux cibles (400)", async ({ request }) => {
    const s = marqueur();
    await creerCandidat(`Comp${s}`, s);
    const c = await clientEtConnexion(request);
    const besoinA = await besoinValide(c.client.id, `Comp${s}`, `${s}a`);
    const besoinB = await besoinValide(c.client.id, `Comp${s}`, `${s}b`);
    const optionA = (await suiviPour(request, besoinA.id)).bloc.profils[0].cible.solutionOptionId;

    const mauvaise = await request.post("/api/client/talents/actions", { data: { needId: besoinB.id, type: "POURSUIVRE", solutionOptionId: optionA } });
    expect(mauvaise.status()).toBe(404);
    const deux = await request.post("/api/client/talents/actions", { data: { needId: besoinA.id, type: "POURSUIVRE", solutionOptionId: optionA, shortlistEntreeId: "x" } });
    expect(deux.status()).toBe(400);
    const soumis = await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `lot2-soumis-${s}`, texteOriginal: "Besoin soumis", statut: "SOUMIS" } });
    const nonValide = await request.post("/api/client/talents/actions", { data: { needId: soumis.id, type: "AUTRES_PROFILS" } });
    expect(nonValide.status()).toBe(409);
  });

  test("l'Admin voit le profil réel derrière la proposition et fait avancer la demande", async ({ request }) => {
    const s = marqueur();
    const candidat = await creerCandidat(`Comp${s}`, s);
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `Comp${s}`, s);
    const bloc = (await suiviPour(request, besoin.id)).bloc;
    const cible = bloc.profils.find((p: { origine: string }) => p.origine === "MATCHING").cible;
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", ...cible } })).status()).toBe(201);

    await connecter(request, "admin-demo@example.com");
    const vue = await request.get(`/api/talent/besoins/${besoin.id}/actions-client`);
    expect(vue.status()).toBe(200);
    const { actions } = await vue.json();
    expect(actions).toHaveLength(1);
    const lien = await prisma.solutionOptionProfilInterne.findUnique({ where: { solutionOptionId: cible.solutionOptionId } });
    expect(actions[0].profil.id).toBe(lien!.profilId);
    expect(lien!.profilId).toBe(candidat.id);

    expect((await request.patch(`/api/talent/actions-client/${actions[0].id}`, { data: { statut: "PRISE_EN_CHARGE" } })).status()).toBe(200);
    expect((await request.patch(`/api/talent/actions-client/${actions[0].id}`, { data: { statut: "PRISE_EN_CHARGE" } })).status()).toBe(409);
    expect((await request.patch(`/api/talent/actions-client/${actions[0].id}`, { data: { statut: "CLOTUREE" } })).status()).toBe(200);
  });
});

test.describe("LOT 2 — ANO-10 : une seule vague d'options par état du besoin", () => {
  test("sans recommandation (correspondances partielles), consulter plusieurs fois ne crée aucune nouvelle option", async ({ request }) => {
    const s = marqueur();
    await creerCandidat(`Comp${s}`, s);
    const c = await clientEtConnexion(request);
    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: c.client.id,
        correlationId: `lot2-ano10-${s}`,
        texteOriginal: `Besoin ANO-10 ${s}`,
        statut: "VALIDE",
        faits: {
          create: [
            { cle: "COMPETENCE", valeur: `Comp${s}`, statut: "DECLARE", source: "extraction" },
            { cle: "COMPETENCE", valeur: `CompAbsente${s}`, statut: "DECLARE", source: "extraction" },
          ],
        },
      },
    });
    const r1 = await (await request.get(`/api/client/besoins/${besoin.id}/solutions`)).json();
    const nb1 = await prisma.solutionOption.count({ where: { needId: besoin.id } });
    const r2 = await (await request.get(`/api/client/besoins/${besoin.id}/solutions`)).json();
    await request.get("/api/client/talents");
    await suiviPour(request, besoin.id);
    const nb2 = await prisma.solutionOption.count({ where: { needId: besoin.id } });
    expect(nb2).toBe(nb1);
    expect(r2.options.map((o: { id: string }) => o.id)).toEqual(r1.options.map((o: { id: string }) => o.id));
  });

  test("après un changement de critères, seule la nouvelle vague est renvoyée (jamais plus de 5 options)", async ({ request }) => {
    const s = marqueur();
    for (let i = 0; i < 4; i++) await creerCandidat(`CompA${s}`, `${s}a${i}`);
    for (let i = 0; i < 4; i++) await creerCandidat(`CompT${s}`, `${s}t${i}`);
    const c = await clientEtConnexion(request);
    const besoin = await besoinValide(c.client.id, `CompA${s}`, s);
    await request.get(`/api/client/besoins/${besoin.id}/solutions`);
    // Changement réel des critères : la compétence A est retirée, T ajoutée.
    await prisma.clientNeedFait.create({ data: { needId: besoin.id, cle: "COMPETENCE", valeur: `CompA${s}`, statut: "INCONNU", source: "client_retrait" } });
    await prisma.clientNeedFait.create({ data: { needId: besoin.id, cle: "COMPETENCE", valeur: `CompT${s}`, statut: "VERIFIE", source: "client_ajout" } });
    const apres = await (await request.get(`/api/client/besoins/${besoin.id}/solutions`)).json();
    expect(apres.options.length).toBeGreaterThan(0);
    expect(apres.options.length).toBeLessThanOrEqual(5);
    for (const o of apres.options) expect(o.competencesCorrespondantes).toContain(`CompT${s}`);
    const { bloc } = await suiviPour(request, besoin.id);
    expect(bloc.profils.map((p: { cle: string }) => p.cle).sort()).toEqual(apres.options.map((o: { id: string }) => o.id).sort());
  });
});
