// Extraction automatique des informations d'un CV par IA (Claude), pour
// pré-remplir le formulaire de vérification de l'ingénieur : celui-ci n'a
// alors qu'à valider (ou corriger) des champs déjà remplis, pas à tout
// retaper.
//
// Nécessite la variable d'environnement ANTHROPIC_API_KEY (clé API Claude),
// à ajouter depuis le tableau de bord Vercel : Settings -> Environment
// Variables -> ANTHROPIC_API_KEY. Si elle est absente, extraireInfosCV()
// lève une erreur explicite plutôt que d'échouer silencieusement, et
// l'appelant (voir app/api/ingenieur/cv/route.ts) retombe alors sur un
// modèle de champs vides à compléter manuellement.

export type ChampCV = {
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
};

// Résultat de l'extraction : en plus des champs pré-remplis, indique si le
// CV analysé correspond bien à un profil informatique / QA (le métier
// d'Atlas Quality Partners) — voir app/api/ingenieur/cv/route.ts, qui
// rejette l'import si horsSecteur est true plutôt que de laisser passer un
// CV sans rapport avec le recrutement d'ingénieurs.
export type ResultatExtractionCV = {
  horsSecteur: boolean;
  secteurDetecte: string; // court résumé du métier/domaine détecté, pour affichage dans le message d'erreur
  champs: ChampCV[];
};

const MODELE_CHAMPS_CV: Omit<ChampCV, "valeur">[] = [
  { categorie: "identite", libelle: "Nom complet", ordre: 0 },
  { categorie: "identite", libelle: "Titre / poste actuel", ordre: 1 },
  { categorie: "contact", libelle: "Email", ordre: 2 },
  { categorie: "contact", libelle: "Téléphone", ordre: 3 },
  { categorie: "contact", libelle: "Localisation", ordre: 4 },
  { categorie: "profil", libelle: "Années d'expérience", ordre: 5 },
  { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", ordre: 6 },
  { categorie: "profil", libelle: "Résumé / profil professionnel", ordre: 7 },
  { categorie: "competence", libelle: "Compétences techniques principales", ordre: 8 },
  { categorie: "competence", libelle: "Compétences secondaires / outils", ordre: 9 },
  { categorie: "competence", libelle: "Langues parlées", ordre: 10 },
  { categorie: "experience", libelle: "Expérience 1 (poste, entreprise, dates)", ordre: 11 },
  { categorie: "experience", libelle: "Expérience 2 (poste, entreprise, dates)", ordre: 12 },
  { categorie: "experience", libelle: "Expérience 3 (poste, entreprise, dates)", ordre: 13 },
  { categorie: "formation", libelle: "Diplôme(s) et établissement(s)", ordre: 14 },
  { categorie: "formation", libelle: "Certifications", ordre: 15 },
];

const MODELE_IA = "claude-haiku-4-5-20251001";

// Modèle de champs vides, utilisé quand l'extraction IA est indisponible ou
// échoue : l'ingénieur peut toujours saisir ses informations manuellement.
export function modeleChampsVides(): ChampCV[] {
  return MODELE_CHAMPS_CV.map((champ) => ({ ...champ, valeur: "" }));
}

// Résultat "neutre" utilisé quand l'extraction/l'analyse IA est indisponible
// (clé absente, erreur réseau, réponse inexploitable) : horsSecteur reste
// false — on ne bloque JAMAIS l'import d'un CV à cause d'un problème
// technique côté IA, seulement quand l'IA a effectivement pu analyser le CV
// et a détecté qu'il n'était pas dans le secteur informatique/QA.
function resultatNeutre(): ResultatExtractionCV {
  return { horsSecteur: false, secteurDetecte: "", champs: modeleChampsVides() };
}

// Extrait les informations d'un CV (PDF) à partir de son contenu binaire, et
// vérifie que le CV correspond bien à un profil informatique / QA (le métier
// d'Atlas Quality Partners) avant de pré-remplir le formulaire de
// vérification. `pdfBase64` doit être le contenu du fichier encodé en
// base64.
// En cas d'échec technique (clé API manquante, erreur réseau, réponse
// inexploitable), retourne un résultat neutre (horsSecteur=false, champs
// vides) plutôt que de bloquer l'import du CV : l'ingénieur pourra toujours
// saisir les informations manuellement dans le formulaire de vérification.
// Ce n'est que lorsque l'IA a pu analyser le CV et conclut positivement
// qu'il ne s'agit pas d'un profil informatique/QA que l'import est rejeté
// (voir app/api/ingenieur/cv/route.ts).
export async function extraireInfosCV(pdfBase64: string): Promise<ResultatExtractionCV> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    throw new Error(
      "L'extraction automatique du CV n'est pas configurée (ANTHROPIC_API_KEY manquant). " +
        "Ajoutez une clé API Claude depuis le tableau de bord Vercel : Settings -> Environment Variables -> ANTHROPIC_API_KEY."
    );
  }

  const listeChamps = MODELE_CHAMPS_CV.map(
    (c, i) => `${i}. [${c.categorie}] ${c.libelle}`
  ).join("\n");

  const prompt = `Voici un CV au format PDF. Atlas Quality Partners est une plateforme de recrutement d'ingénieurs informatique : elle ne recrute QUE pour des métiers en lien direct avec l'informatique, et ne recrute PAS pour d'autres métiers.

Étape 1 — Analyse d'abord si ce CV correspond à un profil informatique, au sens LARGE. Sont considérés comme informatique (liste non exhaustive, tout métier en lien direct avec l'un de ces domaines compte) :
- Développement / ingénierie logicielle (web, mobile, backend, frontend, embarqué...)
- QA / test logiciel / assurance qualité
- Cybersécurité / sécurité informatique (pentest, SOC, RSSI, gouvernance sécurité...)
- Data (data analyst, data engineer, data scientist, BI, bases de données...)
- DevOps / infrastructure / cloud / administration systèmes et réseaux
- Autres métiers IT reconnus : gestion de projet IT, architecture logicielle, support IT, IA/ML, etc.
Un profil junior, en alternance, en formation ou en reconversion VERS l'un de ces domaines compte aussi comme informatique.

Un CV dont le métier principal n'a AUCUN lien direct avec l'un de ces domaines (par exemple : comptabilité/finance, médecine/santé, droit, transport/logistique, restauration, commerce/vente hors tech, RH généraliste, marketing hors tech...) N'est PAS un profil informatique, même si la personne utilise l'informatique dans son travail au quotidien (un comptable qui utilise Excel n'est pas informaticien).

Étape 2 — Extrais ensuite les informations suivantes, dans cet ordre exact (même si le CV n'est pas informatique, extrais ce que tu peux) :
${listeChamps}

Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte autour :
{"secteurInformatique": true ou false, "secteurDetecte": "court résumé du métier/domaine principal du CV, ex: 'Comptabilité' ou 'Développement web'", "champs": [tableau de ${MODELE_CHAMPS_CV.length} chaînes de caractères, une par champ listé ci-dessus, dans le même ordre]}

Pour "champs" : si une information est absente du CV, mets une chaîne vide "" pour ce champ. Pour "Années d'expérience", donne juste un nombre (ex: "7"). Pour "Séniorité", choisis parmi Junior, Confirmé, Senior, Expert en fonction du nombre d'années et du niveau des postes occupés. Reste factuel et base-toi uniquement sur le contenu réel du CV, ne fabrique jamais d'information.`;

  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE_IA,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (e: any) {
    // Pas de réseau / API injoignable : on ne bloque pas l'import du CV.
    console.error("[cv-extraction] Échec réseau vers l'API Anthropic :", e?.message ?? e);
    return resultatNeutre();
  }

  if (!reponse.ok) {
    const corpsErreur = await reponse.text().catch(() => "(corps illisible)");
    console.error(
      `[cv-extraction] Réponse non-OK de l'API Anthropic : ${reponse.status} ${reponse.statusText} — ${corpsErreur}`
    );
    return resultatNeutre();
  }

  let donnees: any;
  try {
    donnees = await reponse.json();
  } catch (e: any) {
    console.error("[cv-extraction] Réponse Anthropic non-JSON :", e?.message ?? e);
    return resultatNeutre();
  }

  const texte: string | undefined = donnees?.content?.[0]?.text;
  if (!texte) {
    console.error("[cv-extraction] Pas de texte dans la réponse Anthropic :", JSON.stringify(donnees).slice(0, 500));
    return resultatNeutre();
  }

  let objet: any;
  try {
    const debut = texte.indexOf("{");
    const fin = texte.lastIndexOf("}");
    const brut = debut !== -1 && fin !== -1 ? texte.slice(debut, fin + 1) : texte;
    objet = JSON.parse(brut);
  } catch (e: any) {
    console.error("[cv-extraction] Échec du parsing JSON de la réponse :", e?.message ?? e, "texte:", texte.slice(0, 500));
    return resultatNeutre();
  }

  const valeurs = objet?.champs;
  if (!Array.isArray(valeurs)) {
    console.error("[cv-extraction] La réponse parsée n'a pas de tableau 'champs' :", JSON.stringify(objet).slice(0, 500));
    return resultatNeutre();
  }

  const champs = MODELE_CHAMPS_CV.map((champ, i) => ({
    ...champ,
    valeur: typeof valeurs[i] === "string" ? valeurs[i] : "",
  }));

  return {
    horsSecteur: objet?.secteurInformatique === false,
    secteurDetecte: typeof objet?.secteurDetecte === "string" ? objet.secteurDetecte : "",
    champs,
  };
}
