// ATLAS FINANCE — Margin Intelligence V1 (Batch 10, 06/09/2026). Marge
// prévisionnelle vs marge réelle par mission et alerte — jamais un chiffre
// inventé, jamais une estimation présentée comme réelle.
//
// SÉCURITÉ CRITIQUE : ce module (et sa route API sœur) ne sont JAMAIS
// exposés à CLIENT ni à INGENIEUR. Voir prisma/schema.prisma, enum Role :
// "ADMIN : accès complet [...] coûts internes" / "CLIENT : [...] aucune
// donnée tarifaire" (le commentaire vise INGENIEUR, mais s'applique tout
// autant à CLIENT — voir app/api/client/missions/route.ts qui ne sélectionne
// explicitement AUCUN champ tarifaire). Les coûts et marges sont une donnée
// strictement interne Atlas.
//
// Réutilise lib/calculs.ts (calculerTjmCout) — la même formule déjà
// utilisée par /api/missions, /api/profils et /admin (reproduit l'onglet
// "Profils" du fichier Excel d'origine) : ce module ne la réimplémente
// jamais, il l'étend avec le réel (CRA), l'écart et l'alerte.
//
// RÈGLE ABSOLUE : la marge RÉELLE n'est calculée que sur des CRA
// (FeuilleDeTemps) au statut "ValideeClient" — le seul statut réellement
// définitif/facturable du circuit (Brouillon -> Soumise -> ValideeAdmin ->
// ValideeClient ; voir lib/feuilles-de-temps.ts STATUTS_CRA). Un CRA encore
// en Brouillon, Soumis, seulement Validé Admin, ou Rejeté, ne compte jamais
// comme du réel — présenter une facturation non définitive comme "réelle"
// serait un chiffre inventé. Sans aucun CRA ValideeClient, la marge réelle
// reste INCONNU (jamais zéro, jamais déduite du prévisionnel).
//
// PAS D'ÉVOLUTION NI D'ÉCART EN POINTS DE MARGE DANS CETTE V1, DÉLIBÉRÉMENT :
// tjmVente et le coût interne (tjmCoutOverhead) sont des valeurs FIXES au
// niveau d'une mission (Mission.tjmVente, Profil.montantSaisi) — le POURCENTAGE
// de marge (margePct = 1 - coût/CA) ne dépend donc jamais du volume de jours
// (planifiés ou réellement facturés) : il est mathématiquement identique
// entre le bloc prévisionnel et le bloc réel, et identique d'un mois de CRA
// à l'autre. Un "écart de marge en points" ou une "tendance de marge"
// calculés sur UNE SEULE mission seraient donc structurellement toujours
// nuls/STABLE : un signal qui ne peut jamais varier n'est pas une
// intelligence, c'est un champ décoratif qui donnerait une fausse impression
// d'analyse. Ce qui varie réellement entre prévisionnel et réel, c'est le
// MONTANT ABSOLU (CA/coût/marge en euros) réellement facturé à date — voir
// BlocMarge.ca/coutTotal/margeEuros — jamais le pourcentage. Une évolution
// ou un écart de marge en % n'aurait de sens qu'agrégés sur un portefeuille
// de missions (par profil/client, dans le temps) — hors périmètre de cette
// V1, qui reste au niveau d'une mission. Voir avertissement ci-dessous.

import { calculerTjmCout } from "@/lib/calculs";

export type NiveauAlerte = "CRITIQUE" | "ATTENTION" | "OK" | "INCONNU";
export type StatutDonnee = "CONNU" | "INCONNU";

export type Hypotheses = {
  joursAn: number;
  chargesSalarie: number;
  fraisFreelance: number;
  overhead: number;
};

export type MissionPourMarge = {
  id: string;
  tjmVente: number;
  nbJours: number;
  margeCible: number;
  statut: string;
  profilType: "SALARIE" | "FREELANCE" | "PORTAGE" | null;
  profilMontantSaisi: number | null;
};

// Un CRA par mois (Mission.feuillesDeTemps) — seul le statut compte ici pour
// décider s'il entre dans le calcul du réel ; voir règle ci-dessus.
export type CraPourMarge = {
  mois: string; // "AAAA-MM" — trie chronologiquement en triant lexicalement
  joursTravailles: number;
  statut: string;
};

export type BlocMarge = {
  statut: StatutDonnee;
  ca: number | null;
  coutTotal: number | null;
  margeEuros: number | null;
  margePct: number | null;
  joursRetenus: number | null;
};

export type AlerteMarge = {
  niveau: NiveauAlerte;
  label: string;
  evidence: string[];
};

export type MarginIntelligence = {
  missionId: string;
  previsionnel: BlocMarge;
  reel: BlocMarge;
  alerte: AlerteMarge;
  avertissement: string;
};

// Seuil simple et documenté : un écart de plus de 10 points de marge sous la
// cible (Mission.margeCible, propre à chaque mission — jamais un seuil
// absolu global) devient CRITIQUE plutôt que simple ATTENTION.
const ECART_CRITIQUE_SOUS_CIBLE = 0.1;

function construireBlocMarge(tjmVente: number, jours: number, tjmCoutOverhead: number | null): BlocMarge {
  if (tjmCoutOverhead == null) {
    return { statut: "INCONNU", ca: null, coutTotal: null, margeEuros: null, margePct: null, joursRetenus: null };
  }
  const ca = Math.round(tjmVente * jours * 100) / 100;
  const coutTotal = Math.round(tjmCoutOverhead * jours * 100) / 100;
  const margeEuros = Math.round((ca - coutTotal) * 100) / 100;
  const margePct = ca > 0 ? Math.round((margeEuros / ca) * 10000) / 10000 : null;
  return { statut: "CONNU", ca, coutTotal, margeEuros, margePct, joursRetenus: jours };
}

function construireAlerte(margePct: number | null, source: "réel" | "prévisionnel", margeCible: number): AlerteMarge {
  if (margePct == null) {
    return {
      niveau: "INCONNU",
      label: "Marge non déterminable : coût interne non calculable (type de contrat ou montant du profil non renseigné)",
      evidence: ["tjmCout indisponible (Profil.type/montantSaisi manquant)"],
    };
  }
  const ecart = Math.round((margePct - margeCible) * 10000) / 10000;
  if (margePct < 0) {
    return {
      niveau: "CRITIQUE",
      label: `Marge ${source} négative — mission en perte`,
      evidence: [`margePct=${margePct} < 0`],
    };
  }
  if (ecart < -ECART_CRITIQUE_SOUS_CIBLE) {
    return {
      niveau: "CRITIQUE",
      label: `Marge ${source} très inférieure à la cible (${Math.round(margeCible * 100)}%)`,
      evidence: [`écart=${ecart} < -${ECART_CRITIQUE_SOUS_CIBLE} vs cible ${margeCible}`],
    };
  }
  if (ecart < 0) {
    return {
      niveau: "ATTENTION",
      label: `Marge ${source} sous la cible (${Math.round(margeCible * 100)}%)`,
      evidence: [`écart=${ecart} < 0 vs cible ${margeCible}`],
    };
  }
  return {
    niveau: "OK",
    label: `Marge ${source} conforme ou supérieure à la cible (${Math.round(margeCible * 100)}%)`,
    evidence: [`écart=${ecart} >= 0 vs cible ${margeCible}`],
  };
}

// Fonction pure centrale — assemble un MarginIntelligence à partir d'une
// mission et de ses CRA déjà chargés (voir route API soeur, une seule
// requête groupée, aucun appel supplémentaire ici). hyp est injecté par
// l'appelant (Hypotheses singleton déjà utilisé par /api/missions et
// /admin), jamais recalculé ici.
export function construireMarginIntelligence(mission: MissionPourMarge, cras: CraPourMarge[], hyp: Hypotheses): MarginIntelligence {
  const tjmCout = calculerTjmCout(mission.profilType, mission.profilMontantSaisi, hyp);
  const tjmCoutOverhead = tjmCout != null ? tjmCout * (1 + hyp.overhead) : null;

  const previsionnel = construireBlocMarge(mission.tjmVente, mission.nbJours, tjmCoutOverhead);

  const crasFacturables = cras.filter((c) => c.statut === "ValideeClient");
  const joursReels = crasFacturables.reduce((s, c) => s + c.joursTravailles, 0);
  const reel = crasFacturables.length > 0 ? construireBlocMarge(mission.tjmVente, joursReels, tjmCoutOverhead) : {
    statut: "INCONNU" as StatutDonnee,
    ca: null,
    coutTotal: null,
    margeEuros: null,
    margePct: null,
    joursRetenus: null,
  };

  const margeDeReference = reel.statut === "CONNU" ? reel.margePct : previsionnel.margePct;
  const sourceAlerte: "réel" | "prévisionnel" = reel.statut === "CONNU" ? "réel" : "prévisionnel";
  const alerte = construireAlerte(margeDeReference, sourceAlerte, mission.margeCible);

  return {
    missionId: mission.id,
    previsionnel,
    reel,
    alerte,
    avertissement:
      "Margin Intelligence V1 — marge réelle calculée uniquement sur CRA validés Client (facturables), jamais une estimation présentée comme réelle. Donnée strictement interne, réservée Admin. Le % de marge est fixe par construction pour une mission (ne dépend pas du volume) : seuls les montants absolus (CA/coût/marge en euros) varient entre prévisionnel et réel ; une évolution ou un écart en % n'aurait de sens qu'agrégés sur un portefeuille de missions.",
  };
}
