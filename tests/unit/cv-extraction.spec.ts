import { test, expect } from "@playwright/test";
import { extraireInfosCV, modeleChampsVides, LIBELLE_ANNEES_EXPERIENCE, LIBELLE_SENIORITE } from "@/lib/cv-extraction";

// ATLAS ENGINEER INTELLIGENCE PROFILE — Phase 1 (28/09/2026).
//
// Tests unitaires purs (pas de DB, pas de serveur) sur le signal
// `extractionReussie` de lib/cv-extraction.ts : avant son introduction, un
// échec technique de l'extraction (clé absente, réseau, réponse
// inexploitable) et un vrai succès avec un CV sans information produisaient
// exactement la même sortie (champs vides), rendant les deux cas
// indiscernables pour l'appelant (voir app/api/ingenieur/cv/route.ts et
// app/ingenieur/cv/page.tsx, qui affiche désormais un message explicite à
// l'ingénieur si extractionReussie === false).
//
// BLOB_READ_WRITE_TOKEN et ANTHROPIC_API_KEY ne sont configurés ni en local
// ni en CI pour ce dépôt (voir tests/api/v24-piece-jointe.spec.ts pour la
// même limitation documentée côté stockage) : un test d'intégration bout en
// bout via POST /api/ingenieur/cv (upload réel + extraction réelle) ne peut
// donc pas aboutir dans cet environnement — l'upload échoue systématiquement
// au stockage avant même d'atteindre la création des InfoCV. Ces tests
// couvrent donc directement la fonction pure, seule partie réellement
// exerçable ici, plutôt que de prétendre à un test d'intégration qui ne
// peut pas s'exécuter dans cet environnement.

test.describe("cv-extraction — signal extractionReussie", () => {
  test("1/4. ANTHROPIC_API_KEY absente -> lève une erreur explicite (comportement inchangé)", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(extraireInfosCV("ignore")).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
    }
  });

  test("2/4. échec réseau vers l'API Anthropic -> résultat neutre avec extractionReussie=false, jamais une exception", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "cle-de-test-factice";
    const fetchOriginal = global.fetch;
    global.fetch = (async () => {
      throw new Error("network down (test)");
    }) as typeof fetch;

    try {
      const resultat = await extraireInfosCV("ignore");
      expect(resultat.extractionReussie).toBe(false);
      expect(resultat.horsSecteur).toBe(false);
      expect(resultat.champs).toHaveLength(modeleChampsVides().length);
      expect(resultat.champs.every((c) => c.valeur === "")).toBe(true);
    } finally {
      global.fetch = fetchOriginal;
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("3/4. réponse Anthropic exploitable -> extractionReussie=true, champs réellement peuplés", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "cle-de-test-factice";
    const fetchOriginal = global.fetch;
    const nbChamps = modeleChampsVides().length;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                secteurInformatique: true,
                secteurDetecte: "Développement web",
                champs: Array.from({ length: nbChamps }, (_, i) => (i === 5 ? "7" : i === 6 ? "Senior" : `valeur-${i}`)),
              }),
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      const resultat = await extraireInfosCV("ignore");
      expect(resultat.extractionReussie).toBe(true);
      expect(resultat.horsSecteur).toBe(false);
      const annees = resultat.champs.find((c) => c.libelle === LIBELLE_ANNEES_EXPERIENCE);
      const seniorite = resultat.champs.find((c) => c.libelle === LIBELLE_SENIORITE);
      expect(annees?.valeur).toBe("7");
      expect(seniorite?.valeur).toBe("Senior");
    } finally {
      global.fetch = fetchOriginal;
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // LOT 11.1 (29/09/2026) — §5 : un JSON TECHNIQUEMENT valide (structure
  // correcte, `extractionReussie=true`) mais dont le CONTENU est vide
  // (CV scanné, illisible, ou réellement sans information) ne doit jamais
  // être confondu avec une extraction exploitable — voir
  // lib/cv-extraction.ts::calculerQualite, additif à ce lot.
  test("5/6. JSON techniquement valide MAIS champs tous vides -> extractionReussie=true, qualiteExtraction=VIDE, aucune compétence ne peut en être déduite", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "cle-de-test-factice";
    const fetchOriginal = global.fetch;
    const nbChamps = modeleChampsVides().length;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                secteurInformatique: true,
                secteurDetecte: "",
                champs: Array.from({ length: nbChamps }, () => ""), // structure valide, contenu réellement vide
              }),
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      const resultat = await extraireInfosCV("ignore");
      // Succès TECHNIQUE réel (JSON exploitable reçu) ...
      expect(resultat.extractionReussie).toBe(true);
      // ... mais AUCUN contenu exploitable : les deux signaux sont
      // désormais distincts, jamais confondus.
      expect(resultat.champsNonVides).toBe(0);
      expect(resultat.qualiteExtraction).toBe("VIDE");
    } finally {
      global.fetch = fetchOriginal;
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("6/6. JSON valide avec quelques champs seulement -> qualiteExtraction=PARTIELLE, jamais EXPLOITABLE à tort", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "cle-de-test-factice";
    const fetchOriginal = global.fetch;
    const nbChamps = modeleChampsVides().length;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                secteurInformatique: true,
                secteurDetecte: "Développement web",
                // Un seul champ non vide sur nbChamps (largement < 1/3).
                champs: Array.from({ length: nbChamps }, (_, i) => (i === 0 ? "Jean Dupont" : "")),
              }),
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      const resultat = await extraireInfosCV("ignore");
      expect(resultat.extractionReussie).toBe(true);
      expect(resultat.champsNonVides).toBe(1);
      expect(resultat.qualiteExtraction).toBe("PARTIELLE");
    } finally {
      global.fetch = fetchOriginal;
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("4/4. JSON de réponse inexploitable -> résultat neutre avec extractionReussie=false", async () => {
    const cleOriginale = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "cle-de-test-factice";
    const fetchOriginal = global.fetch;
    global.fetch = (async () => new Response("ceci n'est pas du JSON", { status: 200 })) as typeof fetch;

    try {
      const resultat = await extraireInfosCV("ignore");
      expect(resultat.extractionReussie).toBe(false);
      expect(resultat.qualiteExtraction).toBe("VIDE");
      expect(resultat.champsNonVides).toBe(0);
    } finally {
      global.fetch = fetchOriginal;
      if (cleOriginale !== undefined) process.env.ANTHROPIC_API_KEY = cleOriginale;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
