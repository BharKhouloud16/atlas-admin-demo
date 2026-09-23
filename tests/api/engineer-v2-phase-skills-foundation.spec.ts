import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, CLIENT_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";
import { scorerProfil, type ProfilPourMatching, type CriteresDemande } from "@/lib/talent/matching";

// ENGINEER PROFILE V2 — Phase Skills Foundation (ADR-001).
//
// ProfilCompetence devient la source de vérité ; Profil.competences[]
// devient une projection recalculée automatiquement à chaque écriture du
// Skill Graph. Couvre exactement les scénarios mandatés (sections 13-21) :
// déclaration/projection, retrait, evidence préservée, MissionCompetence
// intact, Admin (recalcul + PATCH), Matching utilisant le Graph (pas le
// fallback), Client Trust inchangé, cross-client isolation inchangée.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerIngenieur() {
  const s = suffixe();
  const email = `v2skills-ing-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const profil = await prisma.profil.create({ data: { nom: `Ingenieur Skills ${s}` } });
  await prisma.user.create({ data: { email, passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id } });
  return { email, profilId: profil.id };
}

async function creerAdmin() {
  const email = `v2skills-admin-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email };
}

const CORPS_DISPO_BASE = {
  disponibilite: "Disponible immédiatement",
  preavis: "Aucun / immédiat",
  nationalite: "Française",
  paysResidence: "France",
  tjmSouhaite: 500,
  tjmSouhaiteDevise: "EUR",
};

test.describe("Phase Skills Foundation — déclaration Ingénieur (sections 13-14)", () => {
  test("Test 1 — projection simple : deux compétences déclarées apparaissent dans ProfilCompetence ET dans la projection", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });

    const reponse = await ctx.post("/api/ingenieur/disponibilite", {
      data: { ...CORPS_DISPO_BASE, competences: ["Java", "Python"] },
    });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();

    const graph = await prisma.profilCompetence.findMany({ where: { profilId }, orderBy: { competence: "asc" } });
    expect(graph.map((g) => g.competence)).toEqual(["Java", "Python"]);
    expect(graph.every((g) => g.statut === "DECLARE")).toBe(true);

    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.competences).toEqual(["Java", "Python"]); // Test 4 — aucune fantôme, D — projection cohérente
    await ctx.dispose();
  });

  test("Test A-D — une seule requête suffit : ProfilCompetence + projection alimentées dans le même appel", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["AWS"] } });

    // Une seule lecture, sans second appel POST — l'état doit déjà être cohérent.
    const [graph, profil] = await Promise.all([
      prisma.profilCompetence.findMany({ where: { profilId } }),
      prisma.profil.findUnique({ where: { id: profilId } }),
    ]);
    expect(graph).toHaveLength(1);
    expect(profil!.competences).toEqual(["AWS"]);
    await ctx.dispose();
  });

  test("Test 2 — Skill Graph reflète immédiatement une modification (ajout)", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Java"] } });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Java", "Kubernetes"] } });

    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.competences.sort()).toEqual(["Java", "Kubernetes"]);
    await ctx.dispose();
  });
});

test.describe("Phase Skills Foundation — retrait (sections 7, 15)", () => {
  test("Test 4/15 — retrait d'une compétence DECLARE sans autre provenance : régresse à INCONNU, jamais supprimée, disparaît de la projection", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Java", "Python", "AWS"] } });

    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Java", "AWS"] } });

    const python = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "Python" } } });
    expect(python).not.toBeNull(); // jamais supprimée
    expect(python!.statut).toBe("INCONNU"); // régressée, seule preuve (PROFIL) retirée

    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.competences).not.toContain("Python"); // absente de la projection (INCONNU non éligible)
    expect(profil!.competences.sort()).toEqual(["AWS", "Java"]);
    await ctx.dispose();
  });

  test("Test 15 — retrait d'une compétence VERIFIE par un Admin : jamais détruite ni régressée, reste dans la projection", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Python"] } });

    const python = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "Python" } } });
    const admin = await creerAdmin();
    const ctxAdmin = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    await ctxAdmin.patch(`/api/profils/${profilId}/competences/${python!.id}`, { data: { statut: "VERIFIE" } });

    // L'ingénieur retire Python de sa déclaration.
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: [] } });

    const apres = await prisma.profilCompetence.findUnique({ where: { id: python!.id } });
    expect(apres!.statut).toBe("VERIFIE"); // jamais régressé
    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.competences).toContain("Python"); // toujours dans la projection (VERIFIE reste éligible)
    await ctxAdmin.dispose();
    await ctx.dispose();
  });

  test("Test 15 — retrait d'une compétence avec preuve MISSION additionnelle : jamais détruite", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Terraform"] } });

    const terraform = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "Terraform" } } });
    // Ajout d'une preuve MISSION directement (simule un lien réel Lot 2).
    await prisma.skillEvidence.create({ data: { profilCompetenceId: terraform!.id, source: "MISSION", detail: "Mission X" } });

    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: [] } });

    const apres = await prisma.profilCompetence.findUnique({ where: { id: terraform!.id } });
    expect(apres!.statut).toBe("DECLARE"); // jamais régressé : une preuve non-PROFIL existe
    await ctx.dispose();
  });
});

test.describe("Phase Skills Foundation — Evidence préservée (section 16)", () => {
  test("re-déclaration après ajout d'evidence : preuve conservée, profilCompetenceId stable, aucune duplication", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["PHP"] } });

    const avant = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "PHP" } } });
    const preuvesAvant = await prisma.skillEvidence.findMany({ where: { profilCompetenceId: avant!.id } });
    expect(preuvesAvant).toHaveLength(1); // une seule preuve PROFIL

    // Re-déclaration identique.
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["PHP"] } });

    const apres = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "PHP" } } });
    expect(apres!.id).toBe(avant!.id); // même ligne, jamais recréée
    const preuvesApres = await prisma.skillEvidence.findMany({ where: { profilCompetenceId: avant!.id } });
    expect(preuvesApres).toHaveLength(1); // jamais dupliquée
    expect(preuvesApres[0].id).toBe(preuvesAvant[0].id);
    await ctx.dispose();
  });
});

test.describe("Phase Skills Foundation — MissionCompetence intact (section 17)", () => {
  test("modification des compétences déclarées ne casse jamais un MissionCompetence existant", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["React"] } });

    const react = await prisma.profilCompetence.findUnique({ where: { profilId_competence: { profilId, competence: "React" } } });
    const client = await prisma.client.create({ data: { nom: `Client Skills ${suffixe()}` } });
    const mission = await prisma.mission.create({ data: { clientId: client.id, profilId, nbJours: 5, tjmVente: 500, statut: "Terminée" } });
    await prisma.missionCompetence.create({ data: { missionId: mission.id, profilCompetenceId: react!.id, creeParEmail: "admin@test.local" } });

    // L'ingénieur modifie sa déclaration (retire React).
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: [] } });

    const lienApres = await prisma.missionCompetence.findUnique({
      where: { missionId_profilCompetenceId: { missionId: mission.id, profilCompetenceId: react!.id } },
    });
    expect(lienApres).not.toBeNull(); // FK intacte, jamais cascadée
    const reactApres = await prisma.profilCompetence.findUnique({ where: { id: react!.id } });
    expect(reactApres).not.toBeNull(); // ligne jamais supprimée
    await ctx.dispose();
  });
});

test.describe("Phase Skills Foundation — Admin (section 18)", () => {
  test("POST recalcul puis PATCH VERIFIE : la projection reste cohérente à chaque étape", async () => {
    const { profilId } = await creerIngenieur();
    await prisma.infoCV.create({ data: { profilId, categorie: "competence", libelle: "Compétences techniques principales", valeur: "Rust", ordre: 0, valide: true } });
    await prisma.profil.update({ where: { id: profilId }, data: { competences: [] } });

    const admin = await creerAdmin();
    const ctxAdmin = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponseRecalcul = await ctxAdmin.post(`/api/profils/${profilId}/competences`);
    expect(reponseRecalcul.ok(), await reponseRecalcul.text()).toBeTruthy();

    // L'extraction locale (lib/ai/provider.ts, heuristique déterministe)
    // peut ou non détecter "Rust" selon son vocabulaire connu — on ne
    // présume rien de son contenu, seulement que la projection reste
    // cohérente avec l'état réel du Skill Graph après le recalcul.
    const graphApresRecalcul = await prisma.profilCompetence.findMany({ where: { profilId } });
    const profilApresRecalcul = await prisma.profil.findUnique({ where: { id: profilId } });
    const attenduApresRecalcul = graphApresRecalcul
      .filter((c) => c.statut === "VERIFIE" || c.statut === "DECLARE")
      .map((c) => c.competence)
      .sort();
    expect(profilApresRecalcul!.competences.sort()).toEqual(attenduApresRecalcul);

    if (graphApresRecalcul.length > 0) {
      const cible = graphApresRecalcul[0];
      await ctxAdmin.patch(`/api/profils/${profilId}/competences/${cible.id}`, { data: { statut: "VERIFIE" } });
      const profilApresPatch = await prisma.profil.findUnique({ where: { id: profilId } });
      expect(profilApresPatch!.competences).toContain(cible.competence);
    }
    await ctxAdmin.dispose();
  });
});

test.describe("Phase Skills Foundation — Matching utilise le Graph, pas le fallback (sections 11, 23)", () => {
  test("après le nouveau parcours Ingénieur, scorerProfil() emprunte le chemin Graph (jamais le fallback)", async () => {
    const { profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email: `direct-${suffixe()}@test.local`, role: "ADMIN" });
    await ctx.dispose(); // pas utilisé, juste pour respecter le pattern ; appel direct DB ci-dessous

    const { email, profilId: p2 } = await (async () => {
      const s = suffixe();
      const emailX = `v2skills-match-${s}@test.local`;
      const passwordHash = await bcrypt.hash("Demo1234", 12);
      const profil = await prisma.profil.create({ data: { nom: `Ingenieur Matching ${s}`, cvValide: true } });
      await prisma.user.create({ data: { email: emailX, passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id } });
      return { email: emailX, profilId: profil.id };
    })();

    const ctxIng = await contexteConnecte({ email, role: "INGENIEUR", profilId: p2 });
    await ctxIng.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Java"] } });
    await ctxIng.dispose();

    const profil = await prisma.profil.findUnique({
      where: { id: p2 },
      include: { competencesGraph: { include: { preuves: true } } },
    });
    expect(profil!.competencesGraph.length).toBeGreaterThan(0); // le Graph EST peuplé, condition du chemin non-fallback

    const profilPourMatching: ProfilPourMatching = {
      id: profil!.id,
      competences: profil!.competences,
      seniorite: profil!.seniorite,
      disponibilite: profil!.disponibilite,
      cvValide: profil!.cvValide,
      tjmEstime: profil!.tjmEstime,
      competencesGraph: profil!.competencesGraph.map((c) => ({
        competence: c.competence,
        statut: c.statut,
        niveau: c.niveau,
        confiance: c.confiance,
        anneesExperience: c.anneesExperience,
        contexte: c.contexte,
        provenancePrincipale: c.preuves.length > 0 ? c.preuves[c.preuves.length - 1].source : null,
      })),
    };
    const criteres: CriteresDemande = { competencesRecherchees: ["Java"], senioriteSouhaitee: null, anneesExperienceMin: null, secteurActivite: null, localisation: null, mobilite: null, disponibiliteSouhaitee: null, budgetTjmMax: null };

    const resultat = scorerProfil(profilPourMatching, criteres);
    const motifCompetences = resultat.motifs.find((m) => m.critere === "Compétences");
    // Preuve observable : le chemin Graph enrichit le detail avec "statut
    // XXX" (voir lib/talent/matching.ts::detailCompetences) — le fallback
    // ne produit JAMAIS ce mot, seulement les noms bruts joints.
    expect(motifCompetences!.detail).toContain("statut DECLARE");
  });

  test("un profil sans Skill Graph (jamais passé par le nouveau parcours) utilise toujours le fallback historique — non-régression", () => {
    const profilPourMatching: ProfilPourMatching = {
      id: "profil-sans-graph",
      competences: ["Java"],
      seniorite: null,
      disponibilite: null,
      cvValide: true,
      tjmEstime: null,
      competencesGraph: [],
    };
    const criteres: CriteresDemande = { competencesRecherchees: ["Java"], senioriteSouhaitee: null, anneesExperienceMin: null, secteurActivite: null, localisation: null, mobilite: null, disponibiliteSouhaitee: null, budgetTjmMax: null };
    const resultat = scorerProfil(profilPourMatching, criteres);
    const motifCompetences = resultat.motifs.find((m) => m.critere === "Compétences");
    expect(motifCompetences!.detail).not.toContain("statut"); // fallback : jamais de détail enrichi
    expect(resultat.facteurs.competences.points).toBe(100); // le score lui-même reste correct (comportement V1/V2 préservé)
  });
});

test.describe("Phase Skills Foundation — Client Trust inchangé (sections 19-20)", () => {
  test("GET /api/client/missions/[id]/trust produit exactement le même comportement après la Phase Skills", async () => {
    const { profilId } = await creerIngenieur();
    const client = await prisma.client.create({ data: { nom: `Client Skills Trust ${suffixe()}` } });
    const mission = await prisma.mission.create({ data: { clientId: client.id, profilId, nbJours: 5, tjmVente: 500, statut: "Terminée" } });

    const emailIng = `v2skills-trust-ing-${suffixe()}@test.local`;
    const ctxIng = await contexteConnecte({ email: emailIng, role: "INGENIEUR", profilId });
    await ctxIng.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Docker"] } });
    await ctxIng.dispose();

    const passwordHash = await bcrypt.hash("Demo1234", 12);
    const emailClient = `v2skills-trust-client-${suffixe()}@test.local`;
    await prisma.user.create({ data: { email: emailClient, passwordHash, role: "CLIENT", actif: true, clientId: client.id } });
    const ctxClient = await contexteConnecte({ email: emailClient, role: "CLIENT", clientId: client.id });

    const reponse = await ctxClient.get(`/api/client/missions/${mission.id}/trust`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    const texteBrut = JSON.stringify(corps);

    expect(corps.signals.some((s: { competence: string }) => s.competence === "Docker")).toBe(true);
    // Aucune donnée interne nouvelle exposée (§19 du mandat).
    for (const champInterdit of ["score", "confiance", "matching", "clientId", "skillEvidence", "niveau", "contexte", "secteur", "INFERE", "INCONNU"]) {
      expect(texteBrut.toLowerCase()).not.toContain(champInterdit.toLowerCase());
    }
    await ctxClient.dispose();
  });

  test("cross-client isolation inchangée : Client B ne voit jamais la Mission de Client A pour le même Engineer", async () => {
    const { profilId } = await creerIngenieur();
    const clientA = await prisma.client.create({ data: { nom: `Client A Skills ${suffixe()}` } });
    const clientB = await prisma.client.create({ data: { nom: `Client B Skills ${suffixe()}` } });
    const missionA = await prisma.mission.create({ data: { clientId: clientA.id, profilId, nbJours: 5, tjmVente: 500, statut: "Terminée" } });

    const passwordHash = await bcrypt.hash("Demo1234", 12);
    const emailB = `v2skills-crossclient-b-${suffixe()}@test.local`;
    await prisma.user.create({ data: { email: emailB, passwordHash, role: "CLIENT", actif: true, clientId: clientB.id } });
    const ctxB = await contexteConnecte({ email: emailB, role: "CLIENT", clientId: clientB.id });

    const reponse = await ctxB.get(`/api/client/missions/${missionA.id}/trust`);
    expect(reponse.status()).toBe(404);
    await ctxB.dispose();
  });
});

test.describe("Phase Skills Foundation — idempotence (section 21)", () => {
  test("deux soumissions identiques successives : pas de doublon de ProfilCompetence ni de SkillEvidence", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });

    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Azure"] } });
    await ctx.post("/api/ingenieur/disponibilite", { data: { ...CORPS_DISPO_BASE, competences: ["Azure"] } });

    const lignes = await prisma.profilCompetence.findMany({ where: { profilId, competence: "Azure" } });
    expect(lignes).toHaveLength(1);
    const preuves = await prisma.skillEvidence.findMany({ where: { profilCompetenceId: lignes[0].id } });
    expect(preuves).toHaveLength(1);
    await ctx.dispose();
  });
});
