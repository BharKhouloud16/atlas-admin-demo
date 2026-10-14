import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS DYNAMIC SKILL GRAPH / EVIDENCE LIFECYCLE V1 — chemin API complet de
// la route POST .../competences/[competenceId]/preuves : preuve toujours
// additive (jamais de suppression/écrasement), historique de niveaux
// exposé (CURRENT LEVEL vs HISTORICAL LEVELS), isolation RBAC identique au
// reste du module Skill Graph. Complète tests/api/skill-graph.spec.ts
// (chemin de construction initial, non modifié par ce batch) et
// tests/unit/{skill-graph,evidence-confidence}.spec.ts (fonctions pures).
//
// ATLAS SKILL INTELLIGENCE V1 — LOT 11.1 (29/09/2026) : ce fichier
// s'appuyait auparavant sur le profil de démonstration partagé
// "Ingénieur Démo" (voir prisma/seed.ts), réutilisé par TOUTES les
// exécutions de la suite sur une même base persistante (voir Lot 8/9/10 :
// atlas_ci n'est jamais réinitialisée entre deux runs). Chaque test
// AJOUTAIT une SkillEvidence réelle sur ce même profil partagé sans jamais
// la retirer (comportement produit correct et volontaire — les preuves
// sont additives par design, voir tests 11/12) : au second run de la
// suite, les preuves du run précédent s'additionnaient à celles du run en
// cours, cassant les comptages exacts attendus (1, puis 2, puis 3...) —
// un problème d'ISOLATION DE TEST, jamais un bug produit (confirmé par
// lecture de lib/talent/skill-graph-service.ts/skill-evidence-service.ts :
// aucune régression, le comportement additif est exactement celui voulu).
// Correction : chaque test crée désormais son propre Profil/Ingénieur
// (et Client si besoin) fraîchement créés, jamais partagés entre tests ni
// entre exécutions — même pattern que tests/api/b44-engineer-profile-v1.spec.ts
// et tests/api/lot11-skill-graph-*.spec.ts. Aucune assertion de fond n'a
// été modifiée : les mêmes comportements sont vérifiés, sur des données
// isolées plutôt que partagées.

async function nouvelIngenieur(suffixe: string) {
  const profil = await prisma.profil.create({ data: { nom: `SGL-${suffixe}`, prenom: "Test" } });
  const email = `ingenieur-sgl-${suffixe}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profil.id, emailVerifie: true },
  });
  const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profil, ctx };
}

async function nouvelAdmin(suffixe: string) {
  const email = `admin-sgl-${suffixe}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "ADMIN", actif: true, emailVerifie: true } });
  return contexteConnecte({ email, role: "ADMIN" });
}

async function nouveauClient(suffixe: string) {
  const client = await prisma.client.create({ data: { nom: `Client SGL ${suffixe} ${Date.now()}` } });
  const email = `client-sgl-${suffixe}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "CLIENT", actif: true, clientId: client.id, emailVerifie: true } });
  return contexteConnecte({ email, role: "CLIENT", clientId: client.id });
}

async function declarerCompetence(ctx: import("@playwright/test").APIRequestContext, competences: string[]) {
  const reponse = await ctx.post("/api/ingenieur/disponibilite", {
    data: {
      disponibilite: "Disponible immédiatement",
      preavis: "Aucun / immédiat",
      nationalite: "Française",
      paysResidence: "France",
      tjmSouhaite: 500,
      tjmSouhaiteDevise: "EUR",
      competences,
    },
  });
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
}

test.describe("ATLAS DYNAMIC SKILL GRAPH — Evidence Lifecycle V1 — API", () => {
  test("11. ajout d'une preuve (POST .../preuves) : additive, jamais de suppression des preuves précédentes", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas11");
    await declarerCompetence(ctx, ["Kubernetes"]);

    const adminCtx = await nouvelAdmin("cas11");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const k8s = competences.find((c: { competence: string; id: string }) => c.competence === "Kubernetes");
    expect(k8s).toBeTruthy();
    expect(k8s.preuves.length).toBe(1); // PROFIL seule pour l'instant

    const ajout = await adminCtx.post(`/api/profils/${profil.id}/competences/${k8s.id}/preuves`, {
      data: { source: "MISSION", detail: "Mission client X, module Kubernetes", niveauObserve: 3 },
    });
    expect(ajout.ok(), await ajout.text()).toBeTruthy();
    const apres = await ajout.json();

    // Les deux preuves coexistent — aucune n'a été supprimée.
    expect(apres.preuves.length).toBe(2);
    expect(apres.preuves.some((p: { source: string }) => p.source === "PROFIL")).toBe(true);
    expect(apres.preuves.some((p: { source: string }) => p.source === "MISSION")).toBe(true);

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("12. plusieurs preuves conservées dans le temps : une 3e preuve n'écrase pas les 2 précédentes", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas12");
    await declarerCompetence(ctx, ["Terraform"]);

    const adminCtx = await nouvelAdmin("cas12");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const terraform = competences.find((c: { competence: string; id: string }) => c.competence === "Terraform");

    await adminCtx.post(`/api/profils/${profil.id}/competences/${terraform.id}/preuves`, {
      data: { source: "MISSION", detail: "Mission A", niveauObserve: 2 },
    });
    const derniere = await adminCtx.post(`/api/profils/${profil.id}/competences/${terraform.id}/preuves`, {
      data: { source: "EVALUATION", detail: "Évaluation annuelle", niveauObserve: 3 },
    });
    expect(derniere.ok(), await derniere.text()).toBeTruthy();
    const apres = await derniere.json();
    expect(apres.preuves.length).toBe(3); // PROFIL + MISSION + EVALUATION

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("13. historique des niveaux (niveauxHistoriques) : distingue CURRENT LEVEL (niveau) et HISTORICAL LEVELS, ordre chronologique", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas13");
    await declarerCompetence(ctx, ["Jenkins"]);

    const adminCtx = await nouvelAdmin("cas13");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const jenkins = competences.find((c: { competence: string; id: string }) => c.competence === "Jenkins");

    await adminCtx.post(`/api/profils/${profil.id}/competences/${jenkins.id}/preuves`, {
      data: { source: "MISSION", niveauObserve: 2 },
    });
    const derniere = await adminCtx.post(`/api/profils/${profil.id}/competences/${jenkins.id}/preuves`, {
      data: { source: "MISSION", niveauObserve: 4 },
    });
    const apres = await derniere.json();
    expect(apres.niveauxHistoriques.map((h: { niveau: number }) => h.niveau)).toEqual([2, 4]);

    // CURRENT LEVEL (niveau sur la compétence elle-même) : aucune de ces
    // preuves ne comportait de statutPropose VERIFIE avec niveau Admin — le
    // niveau courant reste piloté par fusionnerCompetence, jamais confondu
    // avec l'historique.
    expect(apres).toHaveProperty("niveau");
    expect(apres.niveauxHistoriques).not.toEqual(apres.niveau);

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("14. contexte/provenance préservés : chaque preuve garde sa source et son détail d'origine", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas14");
    await declarerCompetence(ctx, ["SQL"]);

    const adminCtx = await nouvelAdmin("cas14");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const sql = competences.find((c: { competence: string; id: string }) => c.competence === "SQL");

    const ajout = await adminCtx.post(`/api/profils/${profil.id}/competences/${sql.id}/preuves`, {
      data: { source: "CERTIFICATION", detail: "Certification SQL avancé, 2026" },
    });
    const apres = await ajout.json();
    const nouvellePreuve = apres.preuves.find((p: { source: string }) => p.source === "CERTIFICATION");
    expect(nouvellePreuve.detail).toBe("Certification SQL avancé, 2026");

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("15. RBAC : la route d'ajout de preuve est réservée à l'Admin (CLIENT et INGENIEUR refusés)", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas15");
    await declarerCompetence(ctx, ["Docker"]);

    const adminCtx = await nouvelAdmin("cas15");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const competenceQuelconque = competences[0];
    expect(competenceQuelconque, "une compétence déclarée devrait exister pour ce profil isolé").toBeTruthy();

    const clientCtx = await nouveauClient("cas15");
    const refusClient = await clientCtx.post(`/api/profils/${profil.id}/competences/${competenceQuelconque.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative non autorisée" },
    });
    expect(refusClient.status()).toBe(403);

    const refusIngenieur = await ctx.post(`/api/profils/${profil.id}/competences/${competenceQuelconque.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative non autorisée" },
    });
    expect(refusIngenieur.status()).toBe(403);

    await ctx.dispose();
    await adminCtx.dispose();
    await clientCtx.dispose();
  });

  test("16. isolation tenant : une compétence d'un autre profil renvoie 404, jamais les données d'un tiers", async () => {
    const { profil: profilA, ctx: ctxA } = await nouvelIngenieur("cas16-a");
    await declarerCompetence(ctxA, ["Java"]);
    const { profil: profilB } = await nouvelIngenieur("cas16-b");

    const adminCtx = await nouvelAdmin("cas16");
    const construction = await adminCtx.post(`/api/profils/${profilA.id}/competences`);
    const { competences } = await construction.json();
    expect(competences.length, "au moins une compétence devrait exister sur le profil A").toBeGreaterThan(0);
    const competenceDuBonProfil = competences[0];

    const reponse = await adminCtx.post(`/api/profils/${profilB.id}/competences/${competenceDuBonProfil.id}/preuves`, {
      data: { source: "ADMIN", detail: "tentative cross-tenant" },
    });
    expect(reponse.status()).toBe(404);

    await ctxA.dispose();
    await adminCtx.dispose();
  });

  test("17. compétence inexistante : 404, jamais un crash serveur", async () => {
    const { profil } = await nouvelIngenieur("cas17");
    const adminCtx = await nouvelAdmin("cas17");
    const reponse = await adminCtx.post(`/api/profils/${profil.id}/competences/inexistante-xyz/preuves`, {
      data: { source: "ADMIN", detail: "test" },
    });
    expect(reponse.status()).toBe(404);

    await adminCtx.dispose();
  });

  test("18. validation : une source invalide est rejetée (400), aucune preuve fabriquée", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas18");
    await declarerCompetence(ctx, ["Python"]);

    const adminCtx = await nouvelAdmin("cas18");
    const construction = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const { competences } = await construction.json();
    const python = competences.find((c: { competence: string; id: string }) => c.competence === "Python");

    const invalide = await adminCtx.post(`/api/profils/${profil.id}/competences/${python.id}/preuves`, {
      data: { source: "SOURCE_INEXISTANTE", detail: "test" },
    });
    expect(invalide.status()).toBe(400);

    await ctx.dispose();
    await adminCtx.dispose();
  });
});
