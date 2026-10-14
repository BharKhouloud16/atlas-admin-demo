import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { idPublicIngenieur } from "@/lib/talent/engineer-public-id";

// ATLAS LOT 15.5 — Client Requirement Builder : couvre RBAC/IDOR,
// anonymisation stricte de l'identité ingénieur, anti-hallucination et
// "Top 5 jamais complété artificiellement" au niveau HTTP (le détail du
// moteur est déjà couvert sans DB par tests/unit/besoin-matching.spec.ts et
// tests/unit/requirement-analyzer.spec.ts).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function nouveauClient() {
  const s = suffixe();
  const client = await prisma.client.create({ data: { nom: `Client Lot155 ${s}` } });
  const email = `client-lot155-${s}@test.local`;
  const ctx = await contexteConnecte({ email, role: "CLIENT", clientId: client.id });
  return { client, ctx };
}

async function creerDemande(ctx: import("@playwright/test").APIRequestContext) {
  const reponse = await ctx.post("/api/talent/demandes", {
    data: { description: "Besoin de test — recherche un ingénieur pour une mission." },
  });
  expect(reponse.status()).toBe(201);
  return reponse.json();
}

async function creerIngenieurValide(data: {
  competences?: string[];
  anneesExperience?: number;
  disponibilite?: string;
  paysResidence?: string;
  nomReel?: string;
  emailReel?: string;
}) {
  const s = suffixe();
  return prisma.profil.create({
    data: {
      nom: data.nomReel ?? `NomReelSecret-${s}`,
      prenom: "PrenomReelSecret",
      competences: data.competences ?? [],
      anneesExperience: data.anneesExperience,
      disponibilite: data.disponibilite,
      paysResidence: data.paysResidence,
      cvValide: true,
    },
  });
}

test.describe("Lot 15.5 — RBAC", () => {
  test("un Ingénieur n'a accès à aucune route du Requirement Builder", async () => {
    const s = suffixe();
    const profil = await prisma.profil.create({ data: { nom: `Ing-${s}` } });
    const ctx = await contexteConnecte({ email: `ing-lot155-${s}@test.local`, role: "INGENIEUR", profilId: profil.id });
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(ctxClient);

    expect((await ctx.post(`/api/talent/demandes/${demande.id}/besoin/analyser`, { data: { description: "x".repeat(20) } })).status()).toBe(403);
    expect((await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, { data: { criteresGuides: {} } })).status()).toBe(403);
    expect((await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).status()).toBe(403);
    void client;
  });

  test("un Admin n'a pas accès (self-service réservé au Client)", async () => {
    const s = suffixe();
    const ctx = await contexteConnecte({ email: `admin-lot155-${s}@test.local`, role: "ADMIN" });
    const { ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(ctxClient);
    expect((await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).status()).toBe(403);
  });

  test("aucune session -> 403 sur les 3 routes", async ({ request }) => {
    const { ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(ctxClient);
    expect((await request.post(`/api/talent/demandes/${demande.id}/besoin/analyser`, { data: { description: "x".repeat(20) } })).status()).toBe(403);
    expect((await request.patch(`/api/talent/demandes/${demande.id}/besoin`, { data: { criteresGuides: {} } })).status()).toBe(403);
    expect((await request.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).status()).toBe(403);
  });
});

test.describe("Lot 15.5 — IDOR (isolation Client A / Client B)", () => {
  test("Client A ne peut ni lire, ni analyser, ni confirmer, ni matcher le besoin du Client B", async () => {
    const { ctx: ctxA } = await nouveauClient();
    const { ctx: ctxB } = await nouveauClient();
    const demandeB = await creerDemande(ctxB);

    expect((await ctxA.get(`/api/talent/demandes/${demandeB.id}/besoin`)).status()).toBe(404);
    expect((await ctxA.post(`/api/talent/demandes/${demandeB.id}/besoin/analyser`, { data: { description: "x".repeat(20) } })).status()).toBe(404);
    expect(
      (
        await ctxA.patch(`/api/talent/demandes/${demandeB.id}/besoin`, {
          data: { criteresGuides: { skillsRequired: ["Playwright"] } },
        })
      ).status()
    ).toBe(404);
    expect((await ctxA.post(`/api/talent/demandes/${demandeB.id}/besoin/matcher`)).status()).toBe(404);
  });

  test("un ID de demande inexistant renvoie 404, jamais une fuite d'existence", async () => {
    const { ctx } = await nouveauClient();
    const reponse = await ctx.post(`/api/talent/demandes/id-totalement-inexistant/besoin/matcher`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("Lot 15.5 — parcours complet, Mode 2 (critères guidés)", () => {
  test("guidé -> confirmation -> matching -> résultats anonymisés", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);

    const ingenieurCorrespondant = await creerIngenieurValide({
      competences: ["Playwright", "TypeScript"],
      anneesExperience: 6,
      disponibilite: "Disponible immédiatement",
      paysResidence: "France",
      nomReel: "Dupont-Secret",
      emailReel: "vraiemail@secret.example",
    });
    await creerIngenieurValide({ competences: ["COBOL"], anneesExperience: 12 }); // ne doit jamais apparaître

    const confirmation = await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        criteresGuides: {
          skillsRequired: ["Playwright"],
          skillsPreferred: ["Cypress"],
          experienceMinAnnees: 3,
        },
      },
    });
    expect(confirmation.ok()).toBeTruthy();

    const matching = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`);
    expect(matching.ok()).toBeTruthy();
    const corps = await matching.json();

    // La base de test est partagée et cumulative entre fichiers de test
    // (comportement déjà documenté ailleurs dans la suite ATLAS) : on
    // vérifie donc que NOTRE profil apparaît bien, correctement anonymisé —
    // jamais qu'il est le seul résultat, ce qui dépendrait de l'état global
    // de la base plutôt que du comportement de cette route.
    const idAttendu = idPublicIngenieur(ingenieurCorrespondant.id);
    const candidat = corps.resultats.find((r: { ingenieurId: string }) => r.ingenieurId === idAttendu);
    expect(candidat).toBeDefined();
    expect(candidat.ingenieurId).toMatch(/^ENG-[0-9A-F]{6}$/);

    // Aucune fuite d'identité réelle, sous quelque forme que ce soit.
    const texteReponse = JSON.stringify(corps);
    expect(texteReponse).not.toContain("Dupont-Secret");
    expect(texteReponse).not.toContain("PrenomReelSecret");
    expect(texteReponse).not.toContain("vraiemail@secret.example");
    expect(texteReponse).not.toContain(ingenieurCorrespondant.id);

    // Jamais un score nu sans explication factuelle.
    expect(typeof candidat.explication).toBe("string");
    expect(candidat.explication.length).toBeGreaterThan(0);
  });

  test("l'ID public du même ingénieur est stable entre deux appels de matching", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    await creerIngenieurValide({ competences: ["Playwright"], anneesExperience: 5 });

    await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: { criteresGuides: { skillsRequired: ["Playwright"] } },
    });

    const premier = await (await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).json();
    const second = await (await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).json();
    expect(premier.resultats[0].ingenieurId).toBe(second.resultats[0].ingenieurId);
  });
});

test.describe("Lot 15.5 — Top 5 et absence de résultat", () => {
  test("jamais plus de 5 résultats même si davantage de profils correspondent", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    for (let i = 0; i < 8; i++) {
      await creerIngenieurValide({ competences: ["Playwright"], anneesExperience: 10 });
    }
    await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: { criteresGuides: { skillsRequired: ["Playwright"] } },
    });
    const corps = await (await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).json();
    expect(corps.resultats.length).toBeLessThanOrEqual(5);
    expect(corps.maximum).toBe(5);
  });

  test("aucun profil correspondant -> tableau vide + message explicite, jamais un candidat par défaut", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    await creerIngenieurValide({ competences: ["Playwright"], anneesExperience: 10 });

    // Certification REQUIRED : ATLAS ne collecte aucune donnée de
    // certification côté ingénieur — garantit un résultat vide quel que
    // soit l'état (partagé, cumulatif) de la base de test, contrairement à
    // une simple absence de compétence qui dépendrait des autres profils
    // déjà créés par le reste de la suite.
    await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        requirement: {
          role: null,
          experienceMinAnnees: null,
          skills: [{ valeur: "Playwright", priorite: "REQUIRED" }],
          certifications: [{ valeur: "ISTQB", priorite: "REQUIRED" }],
          disponibilite: null,
          localisation: null,
          domaine: null,
          contraintes: [],
          champsInconnus: [],
          provider: "guided",
          confiance: 1,
        },
      },
    });
    const corps = await (await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`)).json();
    expect(corps.resultats).toEqual([]);
    expect(corps.message).toBe("Aucun profil correspondant aux critères obligatoires n'a été trouvé.");
  });

  test("matching refusé (400) tant que le besoin n'a pas été confirmé", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    const reponse = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`);
    expect(reponse.status()).toBe(400);
  });
});

test.describe("Lot 15.5 — Mode 1 (expression libre) et anti-hallucination", () => {
  test("l'analyse ne persiste rien tant que le Client n'a pas confirmé", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);

    const analyse = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/analyser`, {
      data: { description: "Ingénieur Playwright avec 5 ans d'expérience, disponible immédiatement." },
    });
    expect(analyse.ok()).toBeTruthy();
    const { requirement } = await analyse.json();
    expect(requirement.skills.some((s: { valeur: string }) => s.valeur === "Playwright")).toBe(true);

    const avantConfirmation = await ctx.get(`/api/talent/demandes/${demande.id}/besoin`);
    expect((await avantConfirmation.json()).criteresStructures).toBeNull();
  });

  test("rejette une description trop courte (validation zod)", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    const reponse = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/analyser`, { data: { description: "court" } });
    expect(reponse.status()).toBe(400);
  });
});

// ATLAS LOT 15.5.2 — HARDENING REQUIREMENT INTEGRITY.
//
// Couvre bout-en-bout (vrai serveur HTTP, vraie base) l'invariant validé au
// niveau schéma par tests/unit/requirement-structure-validation.spec.ts :
// PATCH .../besoin avec { requirement: ... } doit refuser toute compétence
// hors TOUTES_COMPETENCES, exactement comme le fait déjà le mode guidé.
test.describe("Lot 15.5.2 — invariant skills ⊆ TOUTES_COMPETENCES sur le chemin { requirement: ... }", () => {
  test("Test 2 — une compétence inconnue soumise via { requirement } est refusée (400), jamais persistée", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);

    const patch = await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        requirement: {
          role: null,
          experienceMinAnnees: null,
          skills: [{ valeur: "COMPETENCE_INEXISTANTE_ATLAS_TEST", priorite: "REQUIRED" }],
          certifications: [],
          disponibilite: null,
          localisation: null,
          domaine: null,
          contraintes: [],
          champsInconnus: [],
          provider: "guided",
          confiance: 1,
        },
      },
    });
    expect(patch.status()).toBe(400);

    // Jamais persistée, même partiellement : le besoin reste non confirmé.
    const apres = await (await ctx.get(`/api/talent/demandes/${demande.id}/besoin`)).json();
    expect(apres.criteresStructures).toBeNull();

    // Test 6 (sécurité) : le matching reste bloqué (400), aucune tentative
    // de matcher sur une donnée invalide n'est même possible.
    const matching = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`);
    expect(matching.status()).toBe(400);
  });

  test("Test 1 — une compétence valide soumise via { requirement } est acceptée normalement", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);

    const patch = await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        requirement: {
          role: null,
          experienceMinAnnees: null,
          skills: [{ valeur: "Playwright", priorite: "REQUIRED" }],
          certifications: [],
          disponibilite: null,
          localisation: null,
          domaine: null,
          contraintes: [],
          champsInconnus: [],
          provider: "guided",
          confiance: 1,
        },
      },
    });
    expect(patch.ok()).toBeTruthy();
    const apres = await patch.json();
    expect(apres.criteresStructures.skills).toEqual([{ valeur: "Playwright", priorite: "REQUIRED" }]);
  });

  test("Test 3 — une certification arbitraire (aucune taxonomie fermée ATLAS) reste acceptée via { requirement }", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);

    const patch = await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        requirement: {
          role: null,
          experienceMinAnnees: null,
          skills: [],
          certifications: [{ valeur: "ISTQB", priorite: "PREFERRED" }],
          disponibilite: null,
          localisation: null,
          domaine: null,
          contraintes: [],
          champsInconnus: [],
          provider: "guided",
          confiance: 1,
        },
      },
    });
    expect(patch.ok()).toBeTruthy();
  });

  test("Test 4 — le mode guidé (criteresGuides) reste inchangé : toujours PASS après le durcissement", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    const patch = await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: { criteresGuides: { skillsRequired: ["Playwright"], skillsPreferred: ["Cypress"] } },
    });
    expect(patch.ok()).toBeTruthy();
    const apres = await patch.json();
    expect(apres.criteresStructures.skills).toContainEqual({ valeur: "Playwright", priorite: "REQUIRED" });
  });

  test("Test 5 — une RequirementStructure valide continue de produire le même résultat de matching qu'avant le durcissement", async () => {
    const { ctx } = await nouveauClient();
    const demande = await creerDemande(ctx);
    // "Cypress" (plutôt que "Playwright", déjà utilisé par de nombreux autres
    // tests de cette suite sur cette base de test partagée et cumulative —
    // voir commentaire plus haut dans ce fichier) : garantit que notre propre
    // fixture n'est jamais évincée du Top 5 par des dizaines de profils
    // accumulés par d'autres suites au fil de cette session.
    const ingenieur = await creerIngenieurValide({ competences: ["Cypress"], anneesExperience: 5, disponibilite: "Disponible immédiatement" });

    await ctx.patch(`/api/talent/demandes/${demande.id}/besoin`, {
      data: {
        requirement: {
          role: null,
          experienceMinAnnees: 3,
          skills: [{ valeur: "Cypress", priorite: "REQUIRED" }],
          certifications: [],
          disponibilite: null,
          localisation: null,
          domaine: null,
          contraintes: [],
          champsInconnus: [],
          provider: "guided",
          confiance: 1,
        },
      },
    });
    const matching = await ctx.post(`/api/talent/demandes/${demande.id}/besoin/matcher`);
    expect(matching.ok()).toBeTruthy();
    const corps = await matching.json();
    const idAttendu = idPublicIngenieur(ingenieur.id);
    expect(corps.resultats.some((r: { ingenieurId: string }) => r.ingenieurId === idAttendu)).toBe(true);
  });
});
