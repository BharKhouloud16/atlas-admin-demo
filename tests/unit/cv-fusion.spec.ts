import { test, expect } from "@playwright/test";
import { fusionnerInfosCv, estPdf } from "@/lib/cv-fusion";

// V1 — non-régression : réimporter un CV ne doit jamais écraser
// silencieusement les informations déjà validées par l'ingénieur.
test.describe("V1 — fusion des informations de CV (lib/cv-fusion.ts)", () => {
  const extraits = [
    { categorie: "identite", libelle: "Nom complet", valeur: "Nom extrait", ordre: 0 },
    { categorie: "contact", libelle: "Email", valeur: "extrait@example.com", ordre: 2 },
    { categorie: "profil", libelle: "Années d'expérience", valeur: "7", ordre: 5 },
  ];

  test("premier import : tous les champs extraits sont créés", () => {
    const { aCreer, conservees } = fusionnerInfosCv([], extraits);
    expect(aCreer).toHaveLength(3);
    expect(conservees).toBe(0);
  });

  test("réimport : un champ validé est conservé, jamais recréé ni écrasé", () => {
    const existantes = [
      { categorie: "identite", libelle: "Nom complet", valide: true },
      { categorie: "contact", libelle: "Email", valide: false },
    ];
    const { aCreer, conservees } = fusionnerInfosCv(existantes, extraits);
    expect(conservees).toBe(1);
    expect(aCreer.map((c) => c.libelle)).toEqual(["Email", "Années d'expérience"]);
  });

  test("la comparaison ignore la casse et les espaces ; pas de doublon dans l'extraction", () => {
    const existantes = [{ categorie: "Identite", libelle: " nom complet ", valide: true }];
    const doublon = [...extraits, { categorie: "contact", libelle: "Email", valeur: "autre@example.com", ordre: 9 }];
    const { aCreer } = fusionnerInfosCv(existantes, doublon);
    expect(aCreer.map((c) => c.libelle)).toEqual(["Email", "Années d'expérience"]);
    expect(aCreer.find((c) => c.libelle === "Email")?.valeur).toBe("extrait@example.com");
  });

  test("estPdf : reconnaît la signature %PDF-, rejette un autre contenu", () => {
    expect(estPdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(estPdf(new TextEncoder().encode("PK\u0003\u0004 docx"))).toBe(false);
    expect(estPdf(new Uint8Array())).toBe(false);
  });
});
