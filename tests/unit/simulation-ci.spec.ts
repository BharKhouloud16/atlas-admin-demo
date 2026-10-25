import { test, expect } from "@playwright/test";
import { simulationsCiActives, PREFIXE_URL_SIMULATION } from "@/lib/simulation-ci";
import { extraireInfosCvSimulation, texteLignesPdf } from "@/lib/cv-extraction-simulation";
import { extraireInfosCV } from "@/lib/cv-extraction";
import { uploaderFichier, obtenirFichier } from "@/lib/storage";
import { cvIngenieurFictif, cvHorsSecteurFictif } from "../fixtures/cv-fictif";

// Simulations réservées à la CI (lib/simulation-ci.ts) : impossibles à
// activer sur Vercel, inactives par défaut, aucun échec réel masqué.

const ACTIVE = { CI: "true", ATLAS_SIMULATIONS_CI: "oui" };

async function avecEnv<T>(valeurs: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const avant: Record<string, string | undefined> = {};
  for (const cle of Object.keys(valeurs)) {
    avant[cle] = process.env[cle];
    if (valeurs[cle] === undefined) delete process.env[cle];
    else process.env[cle] = valeurs[cle];
  }
  try {
    return await fn();
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  }
}

test.describe("Simulations CI — activation", () => {
  test("active uniquement avec CI=true et ATLAS_SIMULATIONS_CI=oui, hors Vercel", () => {
    expect(simulationsCiActives(ACTIVE)).toBe(true);
  });

  test("impossible sur Vercel (Preview ou Production), même si les variables sont définies par erreur", () => {
    for (const vercel of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { VERCEL_URL: "x.vercel.app" }]) {
      expect(simulationsCiActives({ ...ACTIVE, ...vercel })).toBe(false);
    }
  });

  test("inactive sans CI=true ou sans la valeur exacte « oui »", () => {
    expect(simulationsCiActives({ ATLAS_SIMULATIONS_CI: "oui" })).toBe(false);
    expect(simulationsCiActives({ CI: "1", ATLAS_SIMULATIONS_CI: "oui" })).toBe(false);
    for (const valeur of ["true", "1", "OUI", "yes", ""]) {
      expect(simulationsCiActives({ CI: "true", ATLAS_SIMULATIONS_CI: valeur })).toBe(false);
    }
    expect(simulationsCiActives({})).toBe(false);
  });
});

test.describe("Simulations CI — extraction déterministe", () => {
  test("relit exactement les champs du PDF fictif, dans l'ordre du modèle", () => {
    const { pdf, lignes } = cvIngenieurFictif("unit");
    const resultat = extraireInfosCvSimulation(pdf.toString("base64"));
    expect(resultat.horsSecteur).toBe(false);
    expect(resultat.champs).toHaveLength(16);
    const attendues = new Map(lignes);
    for (const champ of resultat.champs) expect(champ.valeur).toBe(attendues.get(champ.libelle));
    // Déterministe : deux extractions du même fichier sont identiques.
    expect(extraireInfosCvSimulation(pdf.toString("base64"))).toEqual(resultat);
  });

  test("CV hors secteur informatique : rejeté comme par l'extraction réelle", () => {
    const resultat = extraireInfosCvSimulation(cvHorsSecteurFictif().toString("base64"));
    expect(resultat.horsSecteur).toBe(true);
    expect(resultat.secteurDetecte).toBe("Restauration");
  });

  test("PDF sans texte exploitable : champs vides, jamais inventés", () => {
    const resultat = extraireInfosCvSimulation(Buffer.from("%PDF-1.4\n%%EOF").toString("base64"));
    expect(resultat.horsSecteur).toBe(false);
    expect(resultat.champs.every((c) => c.valeur === "")).toBe(true);
    expect(texteLignesPdf(Buffer.from("%PDF-1.4"))).toEqual([]);
  });

  test("hors simulation, l'extraction réelle échoue toujours sans clé API (échec non masqué)", async () => {
    await avecEnv({ CI: "true", ATLAS_SIMULATIONS_CI: undefined, ANTHROPIC_API_KEY: undefined, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, async () => {
      await expect(extraireInfosCV(cvIngenieurFictif("x").pdf.toString("base64"))).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });
  });

  test("sur Vercel, l'extraction réelle est utilisée même si la simulation est demandée", async () => {
    await avecEnv({ ...ACTIVE, VERCEL_ENV: "preview", ANTHROPIC_API_KEY: undefined }, async () => {
      await expect(extraireInfosCV(cvIngenieurFictif("x").pdf.toString("base64"))).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });
  });
});

test.describe("Simulations CI — stockage du CV", () => {
  test("dossier « cv » simulé : le fichier relu est identique à l'original", async () => {
    await avecEnv({ ...ACTIVE, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, async () => {
      const { pdf } = cvIngenieurFictif("stockage");
      const { url } = await uploaderFichier("cv.pdf", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "cv");
      expect(url.startsWith(PREFIXE_URL_SIMULATION)).toBe(true);
      const fichier = await obtenirFichier(url);
      expect(fichier?.contentType).toBe("application/pdf");
      const relu = Buffer.from(await new Response(fichier!.stream).arrayBuffer());
      expect(relu.equals(pdf)).toBe(true);
    });
  });

  test("autres dossiers : jamais simulés, le stockage réel non configuré échoue comme avant", async () => {
    await avecEnv({ ...ACTIVE, BLOB_READ_WRITE_TOKEN: undefined, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, async () => {
      await expect(uploaderFichier("piece.pdf", new Blob(["x"]), "pieces-jointes")).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    });
  });

  test("hors simulation : le CV n'est pas simulé et un fichier simulé n'est jamais servi", async () => {
    let url = "";
    await avecEnv({ ...ACTIVE, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, async () => {
      url = (await uploaderFichier("cv.pdf", new Blob([new Uint8Array(cvIngenieurFictif("y").pdf)]), "cv")).url;
    });
    await avecEnv({ ...ACTIVE, VERCEL_ENV: "production", BLOB_READ_WRITE_TOKEN: undefined }, async () => {
      await expect(uploaderFichier("cv.pdf", new Blob(["x"]), "cv")).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
      expect(await obtenirFichier(url)).toBeNull();
    });
  });

  test("URL simulée malformée (traversée de répertoire) : jamais lue", async () => {
    await avecEnv({ ...ACTIVE, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, async () => {
      expect(await obtenirFichier(`${PREFIXE_URL_SIMULATION}cv/../../etc/passwd`)).toBeNull();
    });
  });
});
