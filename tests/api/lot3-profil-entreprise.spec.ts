import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// LOT 3 (28/10/2026) — profil entreprise : nouveaux champs, formats contrôlés
// côté serveur, état de complétude renvoyé, et opération protégée
// (« je souhaite poursuivre ») refusée côté serveur tant que les informations
// de contractualisation manquent.

const MDP = "Demo1234";

async function clientIsole(champs: Record<string, string> = {}) {
  const s = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const client = await prisma.client.create({ data: { nom: `Client lot3 ${s}`, ...champs } });
  const email = `client-lot3-${s}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email, s };
}

async function connecter(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/login", { data: { email, password: MDP } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.describe("LOT 3 — profil entreprise", () => {
  test("nouveaux champs enregistrés et complétude mise à jour", async ({ request }) => {
    const { email } = await clientIsole();
    await connecter(request, email);
    const avant = await (await request.get("/api/client/profil")).json();
    expect(avant.completude.prochaineEtape).toBe("QUALIFICATION");

    const r = await request.fetch("/api/client/profil", {
      method: "PATCH",
      data: {
        pays: "France",
        contactReferent: "Mme Martin",
        fonctionContact: "Directrice des opérations",
        email: "contact@acme-fictif.fr",
        formeJuridique: "SAS",
        identifiantEntreprise: "123 456 789",
        adresseSiege: "10 avenue Fictive, 69000 Lyon",
        contactFacturationEmail: "factures@acme-fictif.fr",
        siteWeb: "https://acme-fictif.fr",
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    const apres = await r.json();
    expect(apres.client.adresseSiege).toBe("10 avenue Fictive, 69000 Lyon");
    expect(apres.completude.prochaineEtape).toBeNull();

    // Persistance après une nouvelle session.
    await request.post("/api/auth/logout").catch(() => undefined);
    await connecter(request, email);
    const relu = await (await request.get("/api/client/profil")).json();
    expect(relu.client.contactFacturationEmail).toBe("factures@acme-fictif.fr");
  });

  test("formats refusés côté serveur : e-mail, site Internet, pays hors liste", async ({ request }) => {
    const { email } = await clientIsole();
    await connecter(request, email);
    for (const data of [{ contactFacturationEmail: "pas-un-email" }, { siteWeb: "pas une url" }, { pays: "Atlantide" }]) {
      const r = await request.fetch("/api/client/profil", { method: "PATCH", data });
      expect(r.status(), JSON.stringify(data)).toBe(400);
    }
  });

  test("« je souhaite poursuivre » refusé (409) tant que la contractualisation n'est pas possible, accepté ensuite", async ({ request }) => {
    const { client, email, s } = await clientIsole({ pays: "France", contactReferent: "M. Durand", email: "contact@fictif.fr" });
    await prisma.profil.create({
      data: {
        nom: `CandLot3${s}`,
        prenom: "X",
        cvValide: true,
        // REV-03 : compétence propre au test.
        competences: [`CompLot3${s}`],
        competencesGraph: { create: [{ competence: `CompLot3${s}`, statut: "VERIFIE", confiance: "HAUTE" }] },
        seniorite: "Senior",
        disponibilite: "Disponible immédiatement",
      },
    });
    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: client.id,
        correlationId: `lot3-${s}`,
        texteOriginal: `Besoin lot3 ${s}`,
        statut: "VALIDE",
        faits: { create: [{ cle: "COMPETENCE", valeur: `CompLot3${s}`, statut: "DECLARE", source: "extraction" }] },
      },
    });
    await connecter(request, email);
    // Parcours réel (REV-02) : affichage, puis actualisation de la recherche.
    expect((await (await request.get("/api/client/talents")).json()).besoins[0].etatRecherche).toBe("A_ACTUALISER");
    const { besoins } = await (await request.post("/api/client/talents/actualiser", { data: { needIds: [besoin.id] } })).json();
    const cible = besoins[0].profils[0].cible;

    const refus = await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", ...cible } });
    expect(refus.status()).toBe(409);
    const corps = await refus.json();
    expect(corps.manquants).toEqual(["Forme juridique", "Numéro d'immatriculation", "Adresse du siège", "Fonction de l'interlocuteur"]);
    expect(await prisma.actionTalentClient.count({ where: { needId: besoin.id } })).toBe(0);

    // Les opérations qui n'en dépendent pas restent possibles.
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "AUTRES_PROFILS" } })).status()).toBe(201);

    await request.fetch("/api/client/profil", {
      method: "PATCH",
      data: { formeJuridique: "SARL", identifiantEntreprise: "RC 0000", adresseSiege: "Adresse fictive", fonctionContact: "Gérant" },
    });
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "POURSUIVRE", ...cible } })).status()).toBe(201);
  });
});
