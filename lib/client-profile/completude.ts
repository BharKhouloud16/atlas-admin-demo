// LOT 3 (28/10/2026) — Complétude PROGRESSIVE du profil entreprise.
//
// Fonction pure (aucun accès Prisma) : à partir des champs du Client, dit
// pour chaque ÉTAPE du parcours quelles informations manquent encore. Une
// information n'est exigée qu'à l'étape où ATLAS en a réellement besoin :
//
//   COMPTE            — inscription : raison sociale (déjà obligatoire) ;
//   QUALIFICATION     — confier un projet à qualifier : pays, interlocuteur
//                       principal, un moyen de contact ;
//   CONTRACTUALISATION — poursuivre avec un profil, accepter une proposition :
//                       forme juridique, numéro d'immatriculation, adresse du
//                       siège, fonction de l'interlocuteur ;
//   FACTURATION       — être facturé : adresse et contact de facturation
//                       (à défaut, adresse du siège et e-mail principal).
//
// Ces exigences sont des règles de fonctionnement d'ATLAS, PAS des
// obligations légales : aucune obligation légale propre à un pays n'est
// affirmée ici. L'identifiant fiscal (TVA intracommunautaire, matricule
// fiscal…) dépend du pays et de la situation de l'entreprise : il reste
// « recommandé », jamais bloquant, faute de règle vérifiée par pays.
//
// La progression affichée n'est jamais un pourcentage global trompeur :
// chaque étape est « complète » ou liste ses informations manquantes.

export type EtapeCompletude = "COMPTE" | "QUALIFICATION" | "CONTRACTUALISATION" | "FACTURATION";

export const ETAPES: EtapeCompletude[] = ["COMPTE", "QUALIFICATION", "CONTRACTUALISATION", "FACTURATION"];

export const LIBELLE_ETAPE: Record<EtapeCompletude, string> = {
  COMPTE: "Créer votre compte",
  QUALIFICATION: "Confier un projet",
  CONTRACTUALISATION: "Poursuivre avec un profil ou accepter une proposition",
  FACTURATION: "Être facturé",
};

export type ChampEntreprise =
  | "nom"
  | "pays"
  | "secteur"
  | "contactReferent"
  | "fonctionContact"
  | "email"
  | "telephone"
  | "formeJuridique"
  | "identifiantEntreprise"
  | "identifiantFiscal"
  | "adresseSiege"
  | "adresseFacturation"
  | "contactFacturationNom"
  | "contactFacturationEmail"
  | "siteWeb";

export type ClientPourCompletude = Partial<Record<ChampEntreprise, string | null>>;

export const LIBELLE_CHAMP: Record<ChampEntreprise, string> = {
  nom: "Raison sociale",
  pays: "Pays d'immatriculation",
  secteur: "Secteur d'activité",
  contactReferent: "Interlocuteur principal",
  fonctionContact: "Fonction de l'interlocuteur",
  email: "E-mail de contact",
  telephone: "Téléphone professionnel",
  formeJuridique: "Forme juridique",
  identifiantEntreprise: "Numéro d'immatriculation",
  identifiantFiscal: "Identifiant fiscal (selon le pays)",
  adresseSiege: "Adresse du siège",
  adresseFacturation: "Adresse de facturation",
  contactFacturationNom: "Contact de facturation",
  contactFacturationEmail: "E-mail de facturation",
  siteWeb: "Site Internet",
};

// Une exigence est soit un champ, soit « l'un de ces champs ».
type Exigence = { champs: ChampEntreprise[]; libelle: string };

const EXIGENCES: Record<EtapeCompletude, Exigence[]> = {
  COMPTE: [{ champs: ["nom"], libelle: LIBELLE_CHAMP.nom }],
  QUALIFICATION: [
    { champs: ["pays"], libelle: LIBELLE_CHAMP.pays },
    { champs: ["contactReferent"], libelle: LIBELLE_CHAMP.contactReferent },
    { champs: ["email", "telephone"], libelle: "E-mail ou téléphone de contact" },
  ],
  CONTRACTUALISATION: [
    { champs: ["formeJuridique"], libelle: LIBELLE_CHAMP.formeJuridique },
    { champs: ["identifiantEntreprise"], libelle: LIBELLE_CHAMP.identifiantEntreprise },
    { champs: ["adresseSiege"], libelle: LIBELLE_CHAMP.adresseSiege },
    { champs: ["fonctionContact"], libelle: LIBELLE_CHAMP.fonctionContact },
  ],
  FACTURATION: [
    { champs: ["adresseFacturation", "adresseSiege"], libelle: "Adresse de facturation (ou adresse du siège)" },
    { champs: ["contactFacturationEmail", "email"], libelle: "E-mail de facturation (ou e-mail de contact)" },
  ],
};

const RECOMMANDES: ChampEntreprise[] = ["secteur", "identifiantFiscal", "siteWeb", "telephone", "contactFacturationNom"];

export type EtatEtape = { etape: EtapeCompletude; libelle: string; complete: boolean; manquants: string[] };

export type Completude = {
  etapes: EtatEtape[];
  // Première étape incomplète (null si tout est complet).
  prochaineEtape: EtapeCompletude | null;
  recommandes: string[];
  // LOT 7 / planche (01/11/2026) : avancement global du profil entreprise,
  // en % des informations attendues (obligatoires pour une étape +
  // recommandées), et liste détaillée des informations manquantes.
  pourcentage: number;
  manquantes: InformationManquante[];
};

export type InformationManquante = { libelle: string; niveau: "OBLIGATOIRE" | "RECOMMANDE"; etape: EtapeCompletude | null };

function renseigne(client: ClientPourCompletude, champ: ChampEntreprise): boolean {
  const v = client[champ];
  return typeof v === "string" && v.trim().length > 0;
}

// Chaque étape inclut les exigences des étapes précédentes : on ne peut pas
// contractualiser sans pouvoir être contacté.
export function evaluerCompletude(client: ClientPourCompletude): Completude {
  const etapes: EtatEtape[] = [];
  const manquantsCumules: string[] = [];
  for (const etape of ETAPES) {
    for (const exigence of EXIGENCES[etape]) {
      if (!exigence.champs.some((c) => renseigne(client, c))) manquantsCumules.push(exigence.libelle);
    }
    etapes.push({ etape, libelle: LIBELLE_ETAPE[etape], complete: manquantsCumules.length === 0, manquants: [...manquantsCumules] });
  }
  const manquantes: InformationManquante[] = [];
  let attendues = 0;
  for (const etape of ETAPES) {
    for (const exigence of EXIGENCES[etape]) {
      attendues++;
      if (!exigence.champs.some((c) => renseigne(client, c))) manquantes.push({ libelle: exigence.libelle, niveau: "OBLIGATOIRE", etape });
    }
  }
  const recommandes = RECOMMANDES.filter((c) => !renseigne(client, c)).map((c) => LIBELLE_CHAMP[c]);
  attendues += RECOMMANDES.length;
  for (const libelle of recommandes) manquantes.push({ libelle, niveau: "RECOMMANDE", etape: null });
  return {
    etapes,
    prochaineEtape: etapes.find((e) => !e.complete)?.etape ?? null,
    recommandes,
    pourcentage: Math.round((100 * (attendues - manquantes.length)) / attendues),
    manquantes,
  };
}

export function manquantsPour(client: ClientPourCompletude, etape: EtapeCompletude): string[] {
  return evaluerCompletude(client).etapes.find((e) => e.etape === etape)!.manquants;
}

export const CHAMPS_ENTREPRISE: ChampEntreprise[] = Object.keys(LIBELLE_CHAMP) as ChampEntreprise[];
