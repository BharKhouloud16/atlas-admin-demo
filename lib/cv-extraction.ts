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

// Extrait les informations d'un CV (PDF) à partir de son contenu binaire.
// `pdfBase64` doit être le contenu du fichier encodé en base64.
// En cas d'échec (clé API manquante, erreur réseau, réponse inexploitable),
// retourne un modèle de champs vides plutôt que de bloquer l'import du CV :
// l'ingénieur pourra toujours saisir les informations manuellement dans le
// formulaire de vérification.
export async function extraireInfosCV(pdfBase64: string): Promise<ChampCV[]> {
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

  const prompt = `Voici un CV au format PDF. Extrais-en les informations suivantes, dans cet ordre exact :

${listeChamps}

Réponds UNIQUEMENT avec un tableau JSON de ${MODELE_CHAMPS_CV.length} chaînes de caractères (pas d'objet, pas de texte autour), une par champ, dans le même ordre que la liste ci-dessus. Si une information est absente du CV, mets une chaîne vide "" pour ce champ. Pour "Années d'expérience", donne juste un nombre (ex: "7"). Pour "Séniorité", choisis parmi Junior, Confirmé, Senior, Expert en fonction du nombre d'années et du niveau des postes occupés. Reste factuel et base-toi uniquement sur le contenu réel du CV, ne fabrique jamais d'information.`;

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
    return modeleChampsVides();
  }

  if (!reponse.ok) {
    const corpsErreur = await reponse.text().catch(() => "(corps illisible)");
    console.error(
      `[cv-extraction] Réponse non-OK de l'API Anthropic : ${reponse.status} ${reponse.statusText} — ${corpsErreur}`
    );
    return modeleChampsVides();
  }

  let donnees: any;
  try {
    donnees = await reponse.json();
  } catch (e: any) {
    console.error("[cv-extraction] Réponse Anthropic non-JSON :", e?.message ?? e);
    return modeleChampsVides();
  }

  const texte: string | undefined = donnees?.content?.[0]?.text;
  if (!texte) {
    console.error("[cv-extraction] Pas de texte dans la réponse Anthropic :", JSON.stringify(donnees).slice(0, 500));
    return modeleChampsVides();
  }

  let valeurs: unknown;
  try {
    const debut = texte.indexOf("[");
    const fin = texte.lastIndexOf("]");
    const brut = debut !== -1 && fin !== -1 ? texte.slice(debut, fin + 1) : texte;
    valeurs = JSON.parse(brut);
  } catch (e: any) {
    console.error("[cv-extraction] Échec du parsing JSON de la réponse :", e?.message ?? e, "texte:", texte.slice(0, 500));
    return modeleChampsVides();
  }

  if (!Array.isArray(valeurs)) {
    console.error("[cv-extraction] La réponse parsée n'est pas un tableau :", JSON.stringify(valeurs).slice(0, 500));
    return modeleChampsVides();
  }

  return MODELE_CHAMPS_CV.map((champ, i) => ({
    ...champ,
    valeur: typeof valeurs[i] === "string" ? valeurs[i] : "",
  }));
}
