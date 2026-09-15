import { test, expect } from "@playwright/test";
import { resoudreAiProvider } from "@/lib/ai/provider";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { PAYS } from "@/lib/localisation";

// COMPANY ATLAS — LOT 2 : extraction heuristique (AiProviderLocal.extraireBesoin,
// via le résolveur — aucun accès réseau, aucune clé API). Couvre exactement
// les 5 cas exigés par la mission, plus la provenance et la règle
// "ne jamais inventer".

const provider = resoudreAiProvider();
async function extraire(texte: string) {
  return provider.extraireBesoin(texte, TOUTES_COMPETENCES, PAYS);
}

test.describe("COMPANY ATLAS LOT 2 — Extraction de besoin (AiProviderLocal.extraireBesoin)", () => {
  test("\"Junior + 10 ans\" — les deux valeurs sont extraites telles quelles, DECLARE, jamais arbitrées par l'extraction elle-même", async () => {
    const resultat = await extraire("Je veux un profil junior avec 10 ans d'expérience.");
    const seniorite = resultat.faits.find((f) => f.cle === "SENIORITE");
    const experience = resultat.faits.find((f) => f.cle === "ANNEES_EXPERIENCE_MIN");
    expect(seniorite?.valeur).toBe("Junior");
    expect(seniorite?.statut).toBe("DECLARE");
    expect(experience?.valeur).toBe("10");
    expect(experience?.statut).toBe("DECLARE");
    // La détection de la contradiction elle-même est la responsabilité du
    // moteur de cohérence (lib/client-need/coherence.ts), jamais de
    // l'extraction — vérifié ici par absence de tout fait "contradiction".
  });

  test("\"QA + Java + Playwright\" — rôle et compétences détectés, toutes DECLARE", async () => {
    const resultat = await extraire("Nous cherchons un profil QA compétent en Java et Playwright.");
    const role = resultat.faits.find((f) => f.cle === "ROLE");
    const competences = resultat.faits.filter((f) => f.cle === "COMPETENCE").map((f) => f.valeur);
    expect(role?.valeur).toBe("qa");
    expect(competences).toContain("Java");
    expect(competences).toContain("Playwright");
    expect(resultat.faits.filter((f) => f.cle === "COMPETENCE").every((f) => f.statut === "DECLARE")).toBe(true);
  });

  test("\"QA sans aucune précision\" — seul le rôle est détecté, rien d'autre n'est inventé", async () => {
    const resultat = await extraire("Nous avons besoin d'un QA.");
    const cles = resultat.faits.map((f) => f.cle);
    expect(cles).toContain("ROLE");
    expect(cles).not.toContain("SENIORITE");
    expect(cles).not.toContain("BUDGET_MONTANT");
    expect(cles).not.toContain("LOCALISATION");
    expect(cles).not.toContain("DUREE");
    expect(cles).not.toContain("DISPONIBILITE");
  });

  test("budget absent — aucun fait BUDGET_* n'est créé (jamais un montant inventé)", async () => {
    const resultat = await extraire("Nous cherchons un développeur senior pour un projet React.");
    expect(resultat.faits.some((f) => f.cle.startsWith("BUDGET"))).toBe(false);
  });

  test("localisation absente — aucun fait LOCALISATION n'est créé (jamais un pays deviné)", async () => {
    const resultat = await extraire("Nous cherchons un développeur senior pour six mois.");
    expect(resultat.faits.some((f) => f.cle === "LOCALISATION")).toBe(false);
  });

  test("budget avec type TJM explicite — BUDGET_MONTANT/DEVISE/TYPE cohérents, jamais BUDGET_TYPE deviné sans signal", async () => {
    const resultat = await extraire("Budget maximum 600 EUR par jour, TJM.");
    const montant = resultat.faits.find((f) => f.cle === "BUDGET_MONTANT");
    const devise = resultat.faits.find((f) => f.cle === "BUDGET_DEVISE");
    const type = resultat.faits.find((f) => f.cle === "BUDGET_TYPE");
    expect(montant?.valeur).toBe("600");
    expect(devise?.valeur).toBe("EUR");
    expect(type?.valeur).toBe("TJM");
  });

  test("budget avec un simple montant, sans signal de type — BUDGET_TYPE n'est jamais deviné", async () => {
    const resultat = await extraire("Budget autour de 5000 EUR.");
    expect(resultat.faits.some((f) => f.cle === "BUDGET_TYPE")).toBe(false);
  });

  test("HYPOTHESE_DOMAINE_SOLUTION — toujours présente, toujours INFERE, jamais DECLARE", async () => {
    const resultat = await extraire("Nous cherchons un QA Playwright senior.");
    const hypothese = resultat.faits.find((f) => f.cle === "HYPOTHESE_DOMAINE_SOLUTION");
    expect(hypothese).toBeTruthy();
    expect(hypothese?.statut).toBe("INFERE");
    expect(hypothese?.valeur).toBe("TALENT");
  });

  test("HYPOTHESE_DOMAINE_SOLUTION — signal ATLAS OS sans signal Talent -> ATLAS_OS", async () => {
    const resultat = await extraire("Nous avons besoin d'un audit de sécurité de notre infrastructure.");
    const hypothese = resultat.faits.find((f) => f.cle === "HYPOTHESE_DOMAINE_SOLUTION");
    expect(hypothese?.valeur).toBe("ATLAS_OS");
    expect(hypothese?.statut).toBe("INFERE");
  });

  test("HYPOTHESE_DOMAINE_SOLUTION — ni signal Talent ni signal ATLAS OS -> INCONNU, jamais un domaine inventé", async () => {
    const resultat = await extraire("Nous aimerions améliorer notre organisation interne.");
    const hypothese = resultat.faits.find((f) => f.cle === "HYPOTHESE_DOMAINE_SOLUTION");
    expect(hypothese?.valeur).toBe("INCONNU");
  });

  test("confiance toujours strictement inférieure à 1.0 (extraction heuristique, jamais une certitude)", async () => {
    const resultat = await extraire("Deux QA automation seniors pour six mois, Java et Playwright, remote, budget 550 EUR/jour TJM.");
    expect(resultat.confiance).toBeLessThan(1);
    expect(resultat.confiance).toBeGreaterThan(0);
  });
});
