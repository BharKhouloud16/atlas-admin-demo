import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { modeleChampsVides, LIBELLE_ANNEES_EXPERIENCE, LIBELLE_SENIORITE } from "@/lib/cv-extraction";

// ATLAS ENGINEER INTELLIGENCE PROFILE — Phase 1 (28/09/2026).
//
// Couvre le nouveau workflow "CV -> extraction -> profil prérempli ->
// modification libre -> Continuer" au niveau des routes API réellement
// modifiées (infos, finaliser) et du garde-fou serveur (app/ingenieur/
// page.tsx), SANS passer par POST /api/ingenieur/cv lui-même : ce dépôt n'a
// ni BLOB_READ_WRITE_TOKEN ni ANTHROPIC_API_KEY configurés en local/CI (voir
// tests/api/v24-piece-jointe.spec.ts pour la même limitation déjà
// documentée côté stockage) — l'upload réel échoue systématiquement avant
// la création des InfoCV dans cet environnement. Les InfoCV sont donc semées
// directement en base (comme tests/api/v24-piece-jointe.spec.ts le fait déjà
// pour PieceJointe), exactement dans la forme que produirait un import
// réussi (voir lib/cv-extraction.ts::modeleChampsVides), pour tester tout ce
// qui EST exerçable ici : persistance, IDOR, permissions, finalisation,
// garde-fou. La fonction d'extraction elle-même est couverte séparément
// par tests/unit/cv-extraction.spec.ts.

async function nouvelIngenieur(suffixe: string) {
  const profil = await prisma.profil.create({ data: { nom: `EIP-${suffixe}`, prenom: "Test" } });
  const email = `ingenieur-eip-${suffixe}-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profil.id, emailVerifie: true },
  });
  const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profil, email, ctx };
}

async function semerInfoCV(profilId: string, overrides: Record<string, string> = {}) {
  const champs = modeleChampsVides();
  await prisma.infoCV.createMany({
    data: champs.map((c) => ({
      profilId,
      categorie: c.categorie,
      libelle: c.libelle,
      ordre: c.ordre,
      valeur: overrides[c.libelle] ?? c.valeur,
      valide: false,
    })),
  });
}

test.describe("Engineer Intelligence Profile V1 — GET/PATCH /api/ingenieur/cv/infos", () => {
  test("1. non authentifié -> 403", async ({ request }) => {
    const reponse = await request.get("/api/ingenieur/cv/infos");
    expect(reponse.status()).toBe(403);
  });

  test("2. profil prérempli : GET renvoie les 16 champs extraits, dans l'ordre, avec leurs valeurs", async () => {
    const { profil, ctx } = await nouvelIngenieur("prerempli");
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "7", [LIBELLE_SENIORITE]: "Senior" });

    const reponse = await ctx.get("/api/ingenieur/cv/infos");
    expect(reponse.ok()).toBeTruthy();
    const infos = await reponse.json();
    expect(infos).toHaveLength(modeleChampsVides().length);
    expect(infos.every((i: any, idx: number) => idx === 0 || i.ordre >= infos[idx - 1].ordre)).toBe(true);
    const annees = infos.find((i: any) => i.libelle === LIBELLE_ANNEES_EXPERIENCE);
    expect(annees.valeur).toBe("7");
    expect(annees.valide).toBe(false);

    await ctx.dispose();
  });

  test("3. modification + sauvegarde : PATCH persiste la nouvelle valeur et le statut validé", async () => {
    const { profil, ctx } = await nouvelIngenieur("modif");
    await semerInfoCV(profil.id);
    const [info] = await prisma.infoCV.findMany({ where: { profilId: profil.id }, orderBy: { ordre: "asc" } });

    const reponse = await ctx.patch("/api/ingenieur/cv/infos", {
      data: { id: info.id, valeur: "Jean Dupont (corrigé)", valide: true },
    });
    expect(reponse.ok()).toBeTruthy();

    const relu = await prisma.infoCV.findUnique({ where: { id: info.id } });
    expect(relu?.valeur).toBe("Jean Dupont (corrigé)");
    expect(relu?.valide).toBe(true);

    await ctx.dispose();
  });

  test("4. IDOR : un ingénieur ne peut pas modifier les InfoCV d'un autre", async () => {
    const a = await nouvelIngenieur("idor-a");
    const b = await nouvelIngenieur("idor-b");
    await semerInfoCV(a.profil.id);
    const [infoDeA] = await prisma.infoCV.findMany({ where: { profilId: a.profil.id } });

    const reponse = await b.ctx.patch("/api/ingenieur/cv/infos", {
      data: { id: infoDeA.id, valeur: "Injection depuis B", valide: true },
    });
    expect(reponse.status()).toBe(404);

    const inchange = await prisma.infoCV.findUnique({ where: { id: infoDeA.id } });
    expect(inchange?.valeur).toBe(infoDeA.valeur);

    await a.ctx.dispose();
    await b.ctx.dispose();
  });

  test("5. Client -> 403 (aucune exposition des données internes)", async ({ request }) => {
    const email = `client-eip-${Date.now()}@test.local`;
    const client = await prisma.client.create({ data: { nom: `Client EIP ${Date.now()}` } });
    await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "CLIENT", actif: true, clientId: client.id } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId: client.id });

    const reponse = await ctx.get("/api/ingenieur/cv/infos");
    expect(reponse.status()).toBe(403);

    await ctx.dispose();
  });
});

test.describe("Engineer Intelligence Profile V1 — POST /api/ingenieur/cv/finaliser", () => {
  test("6. bloqué tant qu'un champ reste non validé, cvValide reste false", async () => {
    const { profil, ctx } = await nouvelIngenieur("finaliser-bloque");
    await semerInfoCV(profil.id); // tout valide=false par défaut

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.status()).toBe(400);

    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(false);

    await ctx.dispose();
  });

  test("7. succès : cvValide=true, anneesExperience/seniorite copiés depuis les VRAIES valeurs extraites, JAMAIS pointsForts/tjmEstime/typeContratSuggere fabriqués", async () => {
    const { profil, ctx } = await nouvelIngenieur("finaliser-ok");
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "10 ans", [LIBELLE_SENIORITE]: "Expert" });
    await prisma.infoCV.updateMany({ where: { profilId: profil.id }, data: { valide: true } });

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();

    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(true);
    expect(relu?.anneesExperience).toBe(10); // "10 ans" -> 10, jamais une valeur inventée
    expect(relu?.seniorite).toBe("Expert");
    // Coeur de la correction demandée : ne jamais transformer une colonne
    // "calculée" en fausse donnée dynamique sans source réelle.
    expect(relu?.pointsForts).toBeNull();
    expect(relu?.tjmEstime).toBeNull();
    expect(relu?.typeContratSuggere).toBeNull();

    await ctx.dispose();
  });

  test("8. valeur d'expérience non exploitable ('', texte sans chiffre) -> anneesExperience reste null, pas de crash", async () => {
    const { profil, ctx } = await nouvelIngenieur("finaliser-vide");
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "", [LIBELLE_SENIORITE]: "" });
    await prisma.infoCV.updateMany({ where: { profilId: profil.id }, data: { valide: true } });

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();

    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(true);
    expect(relu?.anneesExperience).toBeNull();
    expect(relu?.seniorite).toBeNull();

    await ctx.dispose();
  });

  test("8b. STALENESS — ré-import réel : anneesExperience/seniorite déjà renseignés doivent devenir null si le nouveau CV n'a plus rien d'exploitable", async () => {
    const { profil, ctx } = await nouvelIngenieur("finaliser-staleness");

    // Étape 1 — première finalisation, avec des valeurs exploitables :
    // reproduit l'état d'un ingénieur dont le profil a déjà été enrichi par
    // un premier import de CV.
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "10", [LIBELLE_SENIORITE]: "Expert" });
    await prisma.infoCV.updateMany({ where: { profilId: profil.id }, data: { valide: true } });
    const premiereFinalisation = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(premiereFinalisation.ok()).toBeTruthy();
    const apresPremiereFinalisation = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(apresPremiereFinalisation?.anneesExperience).toBe(10);
    expect(apresPremiereFinalisation?.seniorite).toBe("Expert");

    // Étape 2 — reproduit EXACTEMENT ce que fait un vrai ré-import (voir
    // app/api/ingenieur/cv/route.ts : deleteMany des InfoCV + recréation +
    // cvValide repassé à false) : le nouveau CV n'a plus d'info exploitable
    // pour ces deux champs (ex. CV moins détaillé, ou extraction en échec).
    await prisma.infoCV.deleteMany({ where: { profilId: profil.id } });
    await prisma.profil.update({ where: { id: profil.id }, data: { cvValide: false } });
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "", [LIBELLE_SENIORITE]: "" });
    await prisma.infoCV.updateMany({ where: { profilId: profil.id }, data: { valide: true } });

    // Étape 3 — appel réel du workflow de finalisation, exactement comme
    // l'écran /ingenieur/cv/verifier le ferait après "Continuer".
    const secondeFinalisation = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(secondeFinalisation.ok()).toBeTruthy();

    // Étape 4 — la régression exacte signalée : les anciennes valeurs ne
    // doivent PAS survivre au ré-import.
    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.anneesExperience).toBeNull();
    expect(relu?.seniorite).toBeNull();
    expect(relu?.cvValide).toBe(true);

    // Étape 5 — aucune autre donnée du profil n'a été touchée par effet de
    // bord (ex. le nom saisi à la création doit rester intact).
    expect(relu?.nom).toBe(profil.nom);
    expect(relu?.pointsForts).toBeNull();
    expect(relu?.tjmEstime).toBeNull();
    expect(relu?.typeContratSuggere).toBeNull();

    await ctx.dispose();
  });

  test("9. sans modification : tout déjà validé -> Continuer peut appeler finaliser directement, aucun blocage", async () => {
    const { profil, ctx } = await nouvelIngenieur("finaliser-sans-modif");
    await semerInfoCV(profil.id, { [LIBELLE_ANNEES_EXPERIENCE]: "3", [LIBELLE_SENIORITE]: "Confirmé" });
    await prisma.infoCV.updateMany({ where: { profilId: profil.id }, data: { valide: true } });

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();
    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(true);

    await ctx.dispose();
  });
});

test.describe("Engineer Intelligence Profile V1 — garde-fou /ingenieur", () => {
  test("10. nouvel ingénieur (aucun CV) -> redirigé vers /ingenieur/cv", async () => {
    const { ctx } = await nouvelIngenieur("garde-fou-nouveau");
    const reponse = await ctx.get("/ingenieur", { maxRedirects: 0 });
    expect(reponse.status()).toBeGreaterThanOrEqual(300);
    expect(reponse.status()).toBeLessThan(400);
    expect(reponse.headers()["location"]).toContain("/ingenieur/cv");
    await ctx.dispose();
  });

  test("11. CV importé mais non validé -> redirigé vers /ingenieur/cv/verifier (profil non bloquant, pas d'écran vide silencieux)", async () => {
    const { profil, ctx } = await nouvelIngenieur("garde-fou-non-valide");
    await prisma.profil.update({ where: { id: profil.id }, data: { cvUrl: "https://blob.example/cv-test.pdf" } });
    await semerInfoCV(profil.id);

    const reponse = await ctx.get("/ingenieur", { maxRedirects: 0 });
    expect(reponse.status()).toBeGreaterThanOrEqual(300);
    expect(reponse.headers()["location"]).toContain("/ingenieur/cv/verifier");
    await ctx.dispose();
  });

  test("12. CV validé mais questionnaire non rempli -> redirigé vers /ingenieur/disponibilite, jamais bloqué sur le profil", async () => {
    const { profil, ctx } = await nouvelIngenieur("garde-fou-disponibilite");
    await prisma.profil.update({ where: { id: profil.id }, data: { cvUrl: "https://blob.example/cv-test.pdf", cvValide: true } });

    const reponse = await ctx.get("/ingenieur", { maxRedirects: 0 });
    expect(reponse.status()).toBeGreaterThanOrEqual(300);
    expect(reponse.headers()["location"]).toContain("/ingenieur/disponibilite");
    await ctx.dispose();
  });

  test("13. ingénieur déjà complet (cvValide=true, questionnaireValide=true) -> accès normal, pas de redirection", async () => {
    const { profil, ctx } = await nouvelIngenieur("garde-fou-complet");
    await prisma.profil.update({
      where: { id: profil.id },
      data: { cvUrl: "https://blob.example/cv-test.pdf", cvValide: true, questionnaireValide: true },
    });

    const reponse = await ctx.get("/ingenieur", { maxRedirects: 0 });
    expect(reponse.status()).toBe(200);
    await ctx.dispose();
  });
});
