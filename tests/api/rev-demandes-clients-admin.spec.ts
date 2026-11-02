import { test, expect, type APIRequestContext } from "@playwright/test";
import { creerClientIsole, connecter } from "../setup/donnees-isolees";
import { prisma } from "@/lib/prisma";

// REV (01/11/2026) — vue Admin « Demandes clients » : les demandes Talents,
// Projets et ATLAS OS d'un client apparaissent, se prennent en charge puis se
// clôturent (transitions contrôlées, journalisées), et le Client voit le
// statut de traitement. Réservée à l'Admin. Données isolées.

const PROPOSITION = {
  niveau: "INDICATIVE",
  approche: "Cadrage puis automatisation",
  perimetre: "Parcours web",
  equipe: [{ role: "Ingénieur QA", nombre: 1, competences: ["Playwright"] }],
  etapes: [{ nom: "Cadrage", livrables: ["Stratégie"], dureeEstimee: "2 semaines" }],
  hypotheses: ["Environnement de recette disponible"],
};

type Demande = { cle: string; source: string; id: string; type: string; statut: string; client: { id: string }; traitableIci: boolean };

async function demandesDe(request: APIRequestContext, clientId: string, statut = "OUVERTES"): Promise<Demande[]> {
  const r = await request.get(`/api/admin/demandes-clients?statut=${statut}`);
  expect(r.status()).toBe(200);
  return ((await r.json()).demandes as Demande[]).filter((d) => d.client.id === clientId);
}

test.describe("REV — demandes clients côté Admin", () => {
  test("réservée à l'Admin : anonyme, Client et Ingénieur refusés", async ({ request }) => {
    expect((await request.get("/api/admin/demandes-clients")).status()).toBe(403);
    expect((await request.patch("/api/admin/demandes-clients/TALENT/x", { data: { statut: "CLOTUREE" } })).status()).toBe(403);
    const c = await creerClientIsole();
    await connecter(request, c.email);
    expect((await request.get("/api/admin/demandes-clients")).status()).toBe(403);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await request.get("/api/admin/demandes-clients")).status()).toBe(403);
  });

  test("parcours complet : Talents, Projets, ATLAS OS — visibles, traités, statut vu par le Client", async ({ request }) => {
    const c = await creerClientIsole({ contractualisation: true });
    const besoin = await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `rev-dc-${c.suffixe}`, titre: `Besoin ${c.suffixe}`, texteOriginal: "Besoin", statut: "VALIDE" } });
    await connecter(request, c.email);
    expect((await request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "AUTRES_PROFILS", commentaire: "Profil plus senior" } })).status()).toBe(201);
    const projetId = (await (await request.post("/api/client/projets", { data: { type: "DELIVERY", titre: `Projet ${c.suffixe}`, objectif: "o", resultatAttendu: "r", perimetre: "p", calendrierSouhaite: "2027" } })).json()).id;
    expect((await request.post("/api/client/atlas-os", { data: { motif: "Audit" } })).status()).toBe(201);

    await connecter(request, "admin-demo@example.com");
    expect((await request.patch(`/api/projets/${projetId}`, { data: { statut: "QUALIFIE" } })).status()).toBe(200);
    expect((await request.post(`/api/projets/${projetId}/propositions`, { data: PROPOSITION })).status()).toBe(201);

    await connecter(request, c.email);
    const proposition = (await (await request.get("/api/client/projets")).json()).projets[0].propositions[0];
    expect((await request.post(`/api/client/projets/${projetId}/actions`, { data: { action: "DEMANDE_PRECISION", propositionId: proposition.id, message: "Inclure l'API ?" } })).status()).toBe(200);

    await connecter(request, "admin-demo@example.com");
    const ouvertes = await demandesDe(request, c.client.id);
    expect(ouvertes.map((d) => `${d.source}:${d.type}:${d.statut}`).sort()).toEqual([
      "ATLAS_OS:ACTIVATION:ENVOYEE",
      "PROJET:DEMANDE_PRECISION:ENVOYEE",
      "TALENT:AUTRES_PROFILS:ENVOYEE",
    ]);

    const talent = ouvertes.find((d) => d.source === "TALENT")!;
    const projet = ouvertes.find((d) => d.source === "PROJET")!;
    const atlasOs = ouvertes.find((d) => d.source === "ATLAS_OS")!;
    expect(atlasOs.traitableIci).toBe(false);
    expect((await request.patch(`/api/admin/demandes-clients/ATLAS_OS/${atlasOs.id}`, { data: { statut: "CLOTUREE" } })).status()).toBe(400);

    expect((await request.patch(`/api/admin/demandes-clients/TALENT/${talent.id}`, { data: { statut: "PRISE_EN_CHARGE" } })).status()).toBe(200);
    expect((await request.patch(`/api/admin/demandes-clients/TALENT/${talent.id}`, { data: { statut: "PRISE_EN_CHARGE" } })).status()).toBe(409);
    expect((await request.patch(`/api/admin/demandes-clients/PROJET/${projet.id}`, { data: { statut: "CLOTUREE" } })).status()).toBe(200);
    expect((await request.patch(`/api/admin/demandes-clients/PROJET/${projet.id}`, { data: { statut: "PRISE_EN_CHARGE" } })).status()).toBe(409);
    expect((await request.patch(`/api/admin/demandes-clients/TALENT/inexistant`, { data: { statut: "CLOTUREE" } })).status()).toBe(404);

    const apres = await demandesDe(request, c.client.id);
    expect(apres.find((d) => d.id === talent.id)?.statut).toBe("PRISE_EN_CHARGE");
    expect(apres.find((d) => d.id === projet.id)).toBeUndefined();
    expect((await demandesDe(request, c.client.id, "CLOTUREES")).map((d) => d.id)).toContain(projet.id);
    expect(await prisma.journalActivite.count({ where: { cible: `PROJET:${projet.id}`, action: "demande_client_cloturee" } })).toBe(1);

    // Le Client voit l'avancement de ses demandes.
    await connecter(request, c.email);
    const suivi = (await (await request.get("/api/client/talents")).json()).besoins.find((b: { besoinId: string }) => b.besoinId === besoin.id);
    expect(suivi.demandesAutresProfils[0].statut).toBe("PRISE_EN_CHARGE");
    const evenement = (await (await request.get("/api/client/projets")).json()).projets[0].evenements.find((e: { type: string }) => e.type === "DEMANDE_PRECISION");
    expect(evenement.statutTraitement).toBe("CLOTUREE");
  });

  test("une proposition acceptée apparaît comme engagement à confirmer, et disparaît une fois l'engagement confirmé", async ({ request }) => {
    const c = await creerClientIsole({ contractualisation: true });
    await connecter(request, c.email);
    const projetId = (await (await request.post("/api/client/projets", { data: { type: "DELIVERY", titre: `Projet ${c.suffixe}`, objectif: "o", resultatAttendu: "r", perimetre: "p", calendrierSouhaite: "2027" } })).json()).id;
    await connecter(request, "admin-demo@example.com");
    await request.patch(`/api/projets/${projetId}`, { data: { statut: "QUALIFIE" } });
    expect((await request.post(`/api/projets/${projetId}/propositions`, { data: { ...PROPOSITION, niveau: "VERIFIEE", delaiEstime: "3 mois", budgetEstimeMin: 1, budgetEstimeMax: 2 } })).status()).toBe(201);
    await connecter(request, c.email);
    const proposition = (await (await request.get("/api/client/projets")).json()).projets[0].propositions[0];
    expect((await request.post(`/api/client/projets/${projetId}/actions`, { data: { action: "ACCEPTER", propositionId: proposition.id } })).status()).toBe(200);

    await connecter(request, "admin-demo@example.com");
    expect((await demandesDe(request, c.client.id)).map((d) => d.source)).toEqual(["ENGAGEMENT"]);
    expect((await request.patch(`/api/projets/${projetId}`, { data: { statut: "ENGAGEMENT_CONFIRME" } })).status()).toBe(200);
    expect(await demandesDe(request, c.client.id)).toEqual([]);
  });
});
