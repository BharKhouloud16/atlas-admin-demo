import { test, expect } from "@playwright/test";
import { classerProfils, scorerProfil, type CriteresDemande, type ProfilPourMatching, type CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { evaluerAdmissibilite, comparerAdmissibles, libelleClient } from "@/lib/talent/admissibilite";
import { comparerOptions } from "@/lib/client-solution/comparaison";
import type { OptionClientSafe } from "@/lib/client-solution/types";

// Fiabilisation du matching (lib/talent/admissibilite.ts) : aucune fausse
// correspondance côté Client, opportunités conservées côté Admin, et une
// information inconnue n'est jamais une compatibilité confirmée.
// Profils et besoins entièrement fictifs.

const BESOIN: CriteresDemande = { competencesRecherchees: ["SoapUI", "SonarQube"], senioriteSouhaitee: null, budgetTjmMax: null };

function graphe(...entrees: [string, CompetenceGraphPourMatching["statut"]][]): CompetenceGraphPourMatching[] {
  return entrees.map(([competence, statut]) => ({ competence, statut, niveau: null, confiance: "MOYENNE", anneesExperience: null, contexte: null, provenancePrincipale: statut === "VERIFIE" ? "ADMIN" : "CV" }));
}

function profil(id: string, options: Partial<ProfilPourMatching> = {}): ProfilPourMatching {
  return {
    id,
    competences: [],
    seniorite: "Senior",
    disponibilite: "Disponible immédiatement",
    cvValide: true,
    tjmEstime: 550,
    anneesExperience: 6,
    paysResidence: "France",
    ...options,
  };
}

function evaluer(p: ProfilPourMatching, criteres: CriteresDemande = BESOIN) {
  return evaluerAdmissibilite(p, criteres, scorerProfil(p, criteres));
}

test.describe("Matching — admissibilité Client et vue Admin", () => {
  test("profil parfaitement adapté (2/2 compétences vérifiées) : correspondance forte, présentable", () => {
    const a = evaluer(profil("parfait", { competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]) }));
    expect(a.niveau).toBe("FORTE");
    expect(a.presentableClient).toBe(true);
    expect(a.competencesVerifiees).toEqual(["SoapUI", "SonarQube"]);
    expect(a.competencesManquantes).toEqual([]);
    expect(a.categorieAdmin).toBe("PRESENTABLE");
  });

  test("profil partiellement adapté (1/2) : correspondance partielle, compétence manquante affichée", () => {
    const a = evaluer(profil("partiel", { competencesGraph: graphe(["SoapUI", "VERIFIE"], ["Java", "VERIFIE"]) }));
    expect(a.niveau).toBe("PARTIELLE");
    expect(a.presentableClient).toBe(true);
    expect(a.competencesManquantes).toEqual(["SonarQube"]);
    expect(libelleClient(a).lignes).toContain("Non couvertes à ce jour : SonarQube.");
  });

  test("critère obligatoire manquant : jamais une correspondance forte", () => {
    const a = evaluer(profil("manque", { competences: ["SoapUI"] }), { ...BESOIN, competencesRecherchees: ["SoapUI", "SonarQube", "Jira"] });
    expect(a.niveau).toBe("PARTIELLE");
    expect(a.competencesManquantes).toEqual(["SonarQube", "Jira"]);
  });

  test("profil sans compétence commune : non admissible côté Client, non pertinent côté Admin", () => {
    const a = evaluer(profil("aucune", { competencesGraph: graphe(["Java", "VERIFIE"], ["React", "VERIFIE"]) }));
    expect(a.niveau).toBe("NON_ADMISSIBLE");
    expect(a.presentableClient).toBe(false);
    expect(a.categorieAdmin).toBe("NON_PERTINENT");
    expect(a.motifsNonAdmissible[0]).toMatch(/aucune des compétences demandées/i);
    // Le moteur ne dit plus « match probable » pour un tel profil.
    expect(scorerProfil(profil("aucune", { competences: ["Java"] }), BESOIN).explication).toBe("Aucune des compétences demandées n'est retrouvée sur ce profil");
  });

  test("compétence extraite du CV non vérifiée : ne couvre jamais le besoin, action Admin proposée", () => {
    const partiel = evaluer(profil("infere", { competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "INFERE"]) }));
    expect(partiel.niveau).toBe("PARTIELLE");
    expect(partiel.competencesNonVerifiees).toEqual(["SonarQube"]);
    expect(partiel.competencesManquantes).toEqual(["SonarQube"]);

    const seulementExtraites = evaluer(profil("infere-seul", { competencesGraph: graphe(["SoapUI", "INFERE"], ["SonarQube", "INFERE"]) }));
    expect(seulementExtraites.presentableClient).toBe(false);
    expect(seulementExtraites.categorieAdmin).toBe("OPPORTUNITE");
    expect(seulementExtraites.actionsAdmin).toContain("Faire vérifier les compétences extraites du CV : SoapUI, SonarQube");
  });

  test("disponibilité incompatible (immédiate exigée, profil non disponible) : exclu du Client, opportunité Admin", () => {
    const a = evaluer(
      profil("indispo", { disponibilite: "Non disponible immédiatement", competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]) }),
      { ...BESOIN, disponibiliteSouhaitee: "Immédiate" }
    );
    expect(a.niveau).toBe("NON_ADMISSIBLE");
    expect(a.contraintesBloquantes.length).toBe(1);
    expect(a.categorieAdmin).toBe("OPPORTUNITE");
    expect(a.actionsAdmin).toContain("Disponibilité incompatible — proposer au client une date de démarrage différée");
  });

  test("budget incompatible (TJM au-dessus du budget maximum) : exclu du Client, opportunité Admin", () => {
    const a = evaluer(profil("cher", { tjmEstime: 800, competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]) }), { ...BESOIN, budgetTjmMax: 600 });
    expect(a.niveau).toBe("NON_ADMISSIBLE");
    expect(a.categorieAdmin).toBe("OPPORTUNITE");
    expect(a.actionsAdmin.some((x) => /budget dépassé/i.test(x))).toBe(true);
  });

  test("aucun profil admissible : rien n'est présenté au Client", () => {
    const profils = [profil("a", { competences: ["Java"] }), profil("b", { competences: [] }), profil("c", { tjmEstime: 900, competences: ["SoapUI"] })];
    const criteres = { ...BESOIN, budgetTjmMax: 500 };
    const presentables = classerProfils(profils, criteres)
      .map((r) => evaluerAdmissibilite(profils.find((p) => p.id === r.profilId)!, criteres, r))
      .filter((a) => a.presentableClient);
    expect(presentables).toEqual([]);
  });

  test.describe("données absentes ou incertaines : jamais une compatibilité confirmée", () => {
    const complet = graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]);

    test("budget exprimé, TJM du profil inconnu : partielle, budget à confirmer", () => {
      const a = evaluer(profil("tjm-inconnu", { tjmEstime: null, competencesGraph: complet }), { ...BESOIN, budgetTjmMax: 600 });
      expect(a.niveau).toBe("PARTIELLE");
      expect(a.contraintesAConfirmer).toEqual(["BUDGET"]);
      expect(libelleClient(a).lignes).toContain("Respect de votre budget à confirmer.");
    });

    test("disponibilité exigée, disponibilité du profil inconnue : partielle, à confirmer", () => {
      const a = evaluer(profil("dispo-inconnue", { disponibilite: null, competencesGraph: complet }), { ...BESOIN, disponibiliteSouhaitee: "Immédiate" });
      expect(a.niveau).toBe("PARTIELLE");
      expect(a.contraintesAConfirmer).toEqual(["DISPONIBILITE"]);
    });

    test("localisation exigée, pays du profil inconnu : partielle, à confirmer", () => {
      const a = evaluer(profil("pays-inconnu", { paysResidence: null, competencesGraph: complet }), { ...BESOIN, localisation: "France" });
      expect(a.niveau).toBe("PARTIELLE");
      expect(a.contraintesAConfirmer).toEqual(["LOCALISATION"]);
    });

    test("besoin sans compétence précisée : aucune correspondance établie", () => {
      const a = evaluer(profil("x", { competencesGraph: complet }), { ...BESOIN, competencesRecherchees: [] });
      expect(a.niveau).toBe("NON_ADMISSIBLE");
    });

    test("statut de compétence INCONNU : traité comme non vérifié", () => {
      const a = evaluer(profil("inconnu", { competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "INCONNU"]) }));
      expect(a.niveau).toBe("PARTIELLE");
      expect(a.competencesNonVerifiees).toEqual(["SonarQube"]);
    });
  });

  test("compétences déclarées par l'ingénieur (sans Skill Graph) : couvrent le besoin, signalées comme déclarées", () => {
    const a = evaluer(profil("declare", { competences: ["SoapUI", "SonarQube"] }));
    expect(a.niveau).toBe("FORTE");
    expect(a.competencesDeclarees).toEqual(["SoapUI", "SonarQube"]);
    expect(libelleClient(a).lignes).toContain("Déclarées par l'ingénieur : SoapUI, SonarQube.");
    expect(a.actionsAdmin).toContain("Vérifier les compétences déclarées par l'ingénieur : SoapUI, SonarQube");
  });

  test("critère souhaité non satisfait (séniorité) : écart négociable, jamais bloquant", () => {
    const a = evaluer(profil("junior", { seniorite: "Junior", competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]) }), { ...BESOIN, senioriteSouhaitee: "Senior" });
    expect(a.presentableClient).toBe(true);
    expect(a.ecartsNegociables.some((e) => e.startsWith("Séniorité"))).toBe(true);
  });

  test("ordre de présentation : fortes d'abord, puis couverture, puis score", () => {
    const profils = [
      profil("partiel", { competences: ["SoapUI"] }),
      profil("fort", { competences: ["SoapUI", "SonarQube"], tjmEstime: null }),
      profil("fort-verifie", { competencesGraph: graphe(["SoapUI", "VERIFIE"], ["SonarQube", "VERIFIE"]) }),
    ];
    const ordre = classerProfils(profils, BESOIN)
      .map((resultat) => ({ resultat, admissibilite: evaluerAdmissibilite(profils.find((p) => p.id === resultat.profilId)!, BESOIN, resultat) }))
      .sort(comparerAdmissibles)
      .map((x) => `${x.resultat.profilId}:${x.admissibilite.niveau}`);
    expect(ordre[2]).toBe("partiel:PARTIELLE");
    expect(ordre.slice(0, 2).every((x) => x.endsWith(":FORTE"))).toBe(true);
  });

  test("libellé Client : ni identité, ni score, ni TJM, ni valeur interne du profil", () => {
    const a = evaluer(profil("Camille-Fictif-123", { seniorite: "Junior", tjmEstime: 777, competencesGraph: graphe(["SoapUI", "VERIFIE"]) }), { ...BESOIN, senioriteSouhaitee: "Senior" });
    const texte = JSON.stringify(libelleClient(a));
    for (const interdit of ["Camille", "777", "Junior", "score", "TJM"]) expect(texte).not.toContain(interdit);
  });

  test("recommandation ATLAS : réservée à une correspondance forte", () => {
    const option = (niveau: "FORTE" | "PARTIELLE", competences: string[]): OptionClientSafe => ({
      typeSolution: "TALENT",
      niveauCorrespondance: niveau,
      competencesCorrespondantes: competences,
      niveauConfiance: "MOYENNE",
      rationale: [],
      criteresAPreciser: [],
      disponibilite: { statut: "CONNUE", detail: "Disponible immédiatement" },
    });
    const seulementPartielle = comparerOptions([option("PARTIELLE", ["SoapUI"])]);
    expect(seulementPartielle.recommandation).toBeNull();
    expect(seulementPartielle.raisonAbsenceRecommandation).toBe("AUCUNE_CORRESPONDANCE_FORTE");

    const mixte = comparerOptions([option("PARTIELLE", ["SoapUI", "SonarQube"]), option("FORTE", ["SoapUI", "SonarQube"])]);
    expect(mixte.optionsOrdonnees[0].niveauCorrespondance).toBe("FORTE");
    expect(mixte.recommandation).not.toBeNull();
  });
});
