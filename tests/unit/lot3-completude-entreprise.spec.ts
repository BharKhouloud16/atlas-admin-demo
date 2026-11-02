import { test, expect } from "@playwright/test";
import { evaluerCompletude, manquantsPour } from "@/lib/client-profile/completude";

// LOT 3 (28/10/2026) — complétude PROGRESSIVE du profil entreprise : une
// information n'est exigée qu'à l'étape qui en a besoin, chaque étape inclut
// les précédentes, et l'identifiant fiscal n'est jamais bloquant.

test.describe("LOT 3 — complétude progressive", () => {
  test("compte tout juste créé : seule l'étape compte est complète", () => {
    const c = evaluerCompletude({ nom: "ACME Industrie" });
    expect(c.etapes.map((e) => [e.etape, e.complete])).toEqual([
      ["COMPTE", true],
      ["QUALIFICATION", false],
      ["CONTRACTUALISATION", false],
      ["FACTURATION", false],
    ]);
    expect(c.prochaineEtape).toBe("QUALIFICATION");
    expect(c.etapes[1].manquants).toEqual(["Pays d'immatriculation", "Interlocuteur principal", "E-mail ou téléphone de contact"]);
  });

  test("un téléphone suffit à la place de l'e-mail pour la qualification", () => {
    expect(manquantsPour({ nom: "A", pays: "France", contactReferent: "Mme Martin", telephone: "+33 1 00 00 00 00" }, "QUALIFICATION")).toEqual([]);
  });

  test("contractualisation : forme juridique, immatriculation, siège, fonction — cumulés avec la qualification", () => {
    const m = manquantsPour({ nom: "A", pays: "France", contactReferent: "Mme Martin", email: "a@b.fr", formeJuridique: "SAS" }, "CONTRACTUALISATION");
    expect(m).toEqual(["Numéro d'immatriculation", "Adresse du siège", "Fonction de l'interlocuteur"]);
  });

  test("facturation : l'adresse du siège et l'e-mail principal tiennent lieu d'adresse et d'e-mail de facturation", () => {
    const complet = {
      nom: "A",
      pays: "Tunisie",
      contactReferent: "M. Ben Ali",
      fonctionContact: "Directeur",
      email: "contact@a.tn",
      formeJuridique: "SARL",
      identifiantEntreprise: "B000000",
      adresseSiege: "Tunis",
    };
    expect(manquantsPour(complet, "FACTURATION")).toEqual([]);
    expect(evaluerCompletude(complet).prochaineEtape).toBeNull();
  });

  test("l'identifiant fiscal et le site Internet restent recommandés, jamais bloquants", () => {
    const c = evaluerCompletude({ nom: "A" });
    expect(c.recommandes).toContain("Identifiant fiscal (selon le pays)");
    expect(c.etapes.flatMap((e) => e.manquants)).not.toContain("Identifiant fiscal (selon le pays)");
  });

  test("une valeur faite d'espaces n'est jamais comptée comme renseignée", () => {
    expect(manquantsPour({ nom: "A", pays: "  ", contactReferent: "X", email: "x@y.fr" }, "QUALIFICATION")).toEqual(["Pays d'immatriculation"]);
  });
});

// LOT 7 / planche (01/11/2026) — avancement global et informations manquantes.
test.describe("Planche — avancement du profil entreprise", () => {
  test("pourcentage : 0 information attendue manquante = 100 %, compte seul = faible", () => {
    const complet = evaluerCompletude({
      nom: "A", pays: "France", contactReferent: "Mme M", email: "a@b.fr", telephone: "+33", fonctionContact: "DSI", formeJuridique: "SAS",
      identifiantEntreprise: "1", adresseSiege: "x", adresseFacturation: "y", contactFacturationNom: "z", contactFacturationEmail: "f@b.fr",
      secteur: "Industrie", identifiantFiscal: "FR1", siteWeb: "https://a.example",
    });
    expect(complet.pourcentage).toBe(100);
    expect(complet.manquantes).toEqual([]);
    const debut = evaluerCompletude({ nom: "A" });
    expect(debut.pourcentage).toBeGreaterThan(0);
    expect(debut.pourcentage).toBeLessThan(20);
  });

  test("informations manquantes : obligatoires (avec leur étape) puis recommandées", () => {
    const c = evaluerCompletude({ nom: "A", pays: "France", contactReferent: "Mme M", email: "a@b.fr" });
    expect(c.manquantes.filter((m) => m.niveau === "OBLIGATOIRE").map((m) => m.etape)).toEqual(["CONTRACTUALISATION", "CONTRACTUALISATION", "CONTRACTUALISATION", "CONTRACTUALISATION", "FACTURATION"]);
    expect(c.manquantes.filter((m) => m.niveau === "RECOMMANDE").map((m) => m.libelle)).toContain("Site Internet");
    expect(c.pourcentage).toBeGreaterThan(30);
    expect(c.pourcentage).toBeLessThan(70);
  });
});
