import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// Fiabilisation du matching, de bout en bout sur la base CI jetable :
// GET /api/client/besoins/[id]/solutions (Client) ne propose que des profils
// admissibles ; GET /api/talent/besoins/[id]/solutions (Admin) garde la vue
// complète (présentables, opportunités, non pertinents) avec écarts et
// actions. Compétences et profils fictifs, uniques à chaque exécution, pour
// ne dépendre d'aucun autre profil présent en base.

type Statut = "VERIFIE" | "DECLARE" | "INFERE";
type AnalyseVue = { profilId: string; admissibilite: { actionsAdmin: string[]; competencesManquantes: string[] } };

async function creerProfil(suffixe: string, nom: string, options: { competences?: [string, Statut][]; tjmEstime?: number | null; disponibilite?: string | null }) {
  return prisma.profil.create({
    data: {
      nom: `${nom} ${suffixe}`,
      prenom: "Fictif",
      cvValide: true,
      seniorite: "Senior",
      anneesExperience: 6,
      paysResidence: "France",
      tjmEstime: options.tjmEstime === undefined ? 550 : options.tjmEstime,
      disponibilite: options.disponibilite === undefined ? "Disponible immédiatement" : options.disponibilite,
      competencesGraph: { create: (options.competences ?? []).map(([competence, statut]) => ({ competence, statut, confiance: statut === "VERIFIE" ? "HAUTE" : "MOYENNE" })) },
    },
  });
}

async function besoin(clientId: string, suffixe: string, competences: string[], autres: { cle: string; valeur: string }[] = []) {
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `matching-${suffixe}-${Math.random()}`,
      texteOriginal: `Besoin matching ${suffixe}`,
      statut: "VALIDE",
      faits: { create: [...competences.map((valeur) => ({ cle: "COMPETENCE" as const, valeur, statut: "DECLARE" as const })), ...autres.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: "DECLARE" as const }))] },
    },
  });
}

test.describe("Matching fiabilisé — Client et Admin", () => {
  test("le Client ne voit que les profils admissibles ; l'Admin voit aussi les opportunités, avec écarts et actions", async () => {
    const s = `${Date.now()}`;
    const A = `CompA-${s}`;
    const B = `CompB-${s}`;
    const parfait = await creerProfil(s, "Parfait", { competences: [[A, "VERIFIE"], [B, "VERIFIE"]] });
    const partiel = await creerProfil(s, "Partiel", { competences: [[A, "VERIFIE"]] });
    const aucune = await creerProfil(s, "Aucune", { competences: [[`Autre-${s}`, "VERIFIE"]] });
    const cher = await creerProfil(s, "Cher", { competences: [[A, "VERIFIE"], [B, "VERIFIE"]], tjmEstime: 800 });
    const indispo = await creerProfil(s, "Indispo", { competences: [[A, "VERIFIE"], [B, "VERIFIE"]], disponibilite: "Non disponible immédiatement" });
    const extrait = await creerProfil(s, "Extrait", { competences: [[A, "INFERE"], [B, "INFERE"]] });
    const tjmInconnu = await creerProfil(s, "TjmInconnu", { competences: [[A, "VERIFIE"], [B, "VERIFIE"]], tjmEstime: null });

    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await besoin(clientDemo.id, s, [A, B], [{ cle: "BUDGET_MONTANT", valeur: "600" }, { cle: "DISPONIBILITE", valeur: "Immédiate" }]);

    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    const reponse = await client.get(`/api/client/besoins/${need.id}/solutions`);
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();

    // 3 profils admissibles : le parfait (forte), puis les partiels — TJM inconnu (2/2, budget à confirmer) et 1/2.
    expect(corps.options.map((o: { titre: string }) => o.titre)).toEqual([
      `Correspondance forte — ${A}, ${B}`,
      `Correspondance partielle — ${A}, ${B}`,
      `Correspondance partielle — ${A}`,
    ]);
    expect(corps.options[0].niveauCorrespondance).toBe("FORTE");
    expect(corps.options[1].justification).toContain("Respect de votre budget à confirmer.");
    expect(corps.options[2].competencesManquantes).toEqual([B]);
    expect(corps.options[2].justification).toContain(`Non couvertes à ce jour : ${B}.`);
    expect(corps.recommandation).not.toBeNull();
    expect(corps.recommandation.competencesCorrespondantes).toEqual([A, B]);

    // Aucun profil exclu (budget, disponibilité, compétences extraites seulement, aucune compétence) ;
    // aucune identité, aucun TJM, aucun score, aucune formulation trompeuse.
    // (champs affichés seulement : les identifiants aléatoires des options pourraient contenir ces chiffres par hasard)
    const affiche = (o: Record<string, unknown>) => JSON.stringify([o.titre, o.justification, o.competencesCorrespondantes, o.competencesManquantes, o.criteresAPreciser, o.disponibilite]);
    const texte = [...corps.options, corps.recommandation].map(affiche).join(" ");
    for (const interdit of ["Fictif", "Parfait", "800", "550", "Match probable"]) {
      expect(texte, interdit).not.toContain(interdit);
    }
    for (const cle of ["profilId", "scoreMatching", "tjmEstime"]) expect(JSON.stringify(corps)).not.toContain(cle);

    // Vue Admin : complète, lecture seule.
    const admin = await contexteConnecte({ email: "admin-demo@example.com", role: "ADMIN" });
    const avant = await prisma.solutionOption.count({ where: { needId: need.id } });
    const vue = await (await admin.get(`/api/talent/besoins/${need.id}/solutions`)).json();
    expect(await prisma.solutionOption.count({ where: { needId: need.id } })).toBe(avant);

    const ids = (liste: AnalyseVue[]) => liste.map((x) => x.profilId);
    expect(ids(vue.analyse.presentables)).toEqual(expect.arrayContaining([parfait.id, partiel.id, tjmInconnu.id]));
    expect(ids(vue.analyse.opportunites)).toEqual(expect.arrayContaining([cher.id, indispo.id, extrait.id]));
    expect([...ids(vue.analyse.presentables), ...ids(vue.analyse.opportunites)]).not.toContain(aucune.id);

    const parId = new Map<string, AnalyseVue>([...vue.analyse.presentables, ...vue.analyse.opportunites].map((x: AnalyseVue) => [x.profilId, x]));
    const actions = (id: string) => parId.get(id)!.admissibilite.actionsAdmin;
    expect(actions(cher.id).some((x) => /budget dépassé/i.test(x))).toBe(true);
    expect(actions(indispo.id)).toContain("Disponibilité incompatible — proposer au client une date de démarrage différée");
    expect(actions(extrait.id)).toContain(`Faire vérifier les compétences extraites du CV : ${A}, ${B}`);
    expect(actions(tjmInconnu.id).some((x) => /TJM du profil non renseigné/.test(x))).toBe(true);
    // Jamais une compétence inventée : l'Admin voit exactement ce qui est vérifié, déclaré ou manquant.
    expect(parId.get(partiel.id)!.admissibilite.competencesManquantes).toEqual([B]);
  });

  test("aucun profil admissible : aucune option ni recommandation pour le Client", async () => {
    const s = `${Date.now()}-vide`;
    await creerProfil(s, "SansRapport", { competences: [[`Autre-${s}`, "VERIFIE"]] });
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await besoin(clientDemo.id, s, [`Introuvable-${s}`]);
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    const corps = await (await client.get(`/api/client/besoins/${need.id}/solutions`)).json();
    expect(corps.eligible).toBe(true);
    expect(corps.options).toEqual([]);
    expect(corps.recommandation).toBeNull();
  });

  test("la vue Admin (identités, scores, actions) reste interdite au Client et à l'Ingénieur", async () => {
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await besoin(clientDemo.id, `${Date.now()}-droits`, ["SoapUI"]);
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    expect((await client.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
    const profil = await prisma.profil.create({ data: { nom: "Ingé droits", prenom: "Fictif" } });
    const ingenieur = await contexteConnecte({ email: `droits-${Date.now()}@example.invalid`, role: "INGENIEUR", profilId: profil.id });
    expect((await ingenieur.get(`/api/talent/besoins/${need.id}/solutions`)).status()).toBe(403);
  });
});
