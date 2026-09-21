// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 4.
//
// Étend le principe de fraîcheur DÉJÀ en place pour les preuves de
// compétence (voir lib/talent/evidence-confidence.ts, FRAICHEUR_ANCIENNE_JOURS
// = 730) à Profil.disponibiliteRenseigneeLe — un champ existant, jamais un
// nouveau moteur de fraîcheur (mandat CEO : "Ne pas créer un nouveau moteur
// Freshness"). Seuils volontairement plus courts que les 730 jours des
// compétences : la disponibilité est une donnée bien plus périssable qu'une
// compétence technique (elle peut changer du jour au lendemain), donc des
// paliers en semaines, pas en années.
//
// RÈGLE ABSOLUE (identique à evidence-confidence.ts) : la fraîcheur est un
// facteur d'INFORMATION, jamais une modification silencieuse de la valeur
// déclarée — ce module ne touche jamais Profil.disponibilite lui-même,
// seulement une qualification de son ancienneté à afficher à côté.
//
// Pure, DB-free, testable sans base de données.

export type FraicheurDisponibilite = "RECENTE" | "VIEILLISSANTE" | "OBSOLETE" | "INCONNUE";

const SEUIL_RECENTE_JOURS = 30;
const SEUIL_VIEILLISSANTE_JOURS = 90;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// Frontières explicites (mandat CEO, tests attendus) :
//   [0, 30]    jours -> RECENTE
//   ]30, 90]   jours -> VIEILLISSANTE
//   ]90, +inf) jours -> OBSOLETE
//   absence de date -> INCONNUE (jamais assimilée à OBSOLETE : on ne sait
//   simplement pas, ce n'est pas la même chose qu'une donnée ancienne connue)
export function evaluerFraicheurDisponibilite(
  disponibiliteRenseigneeLe: Date | null,
  maintenant: Date = new Date()
): FraicheurDisponibilite {
  if (!disponibiliteRenseigneeLe) return "INCONNUE";

  const jours = Math.floor((maintenant.getTime() - disponibiliteRenseigneeLe.getTime()) / MS_PAR_JOUR);
  // Une date future (horloge cliente incohérente, ou fuseau horaire limite)
  // n'est jamais traitée comme "plus fraîche que récente" au-delà de
  // RECENTE — jamais un état inventé au-delà du vocabulaire fermé.
  if (jours <= SEUIL_RECENTE_JOURS) return "RECENTE";
  if (jours <= SEUIL_VIEILLISSANTE_JOURS) return "VIEILLISSANTE";
  return "OBSOLETE";
}

// Traduction courte, factuelle, jamais alarmiste — même esprit que le
// vocabulaire neutre de evidence-confidence.ts ("à vérifier", jamais
// "mensonge").
export function explicationFraicheurDisponibilite(fraicheur: FraicheurDisponibilite, jours: number | null): string {
  switch (fraicheur) {
    case "RECENTE":
      return `Disponibilité renseignée il y a ${jours} jour(s) — récente.`;
    case "VIEILLISSANTE":
      return `Disponibilité renseignée il y a ${jours} jour(s) — à confirmer avant de matcher sur ce critère.`;
    case "OBSOLETE":
      return `Disponibilité renseignée il y a ${jours} jour(s) — probablement obsolète, à faire reconfirmer par l'ingénieur.`;
    case "INCONNUE":
      return "Disponibilité jamais renseignée.";
  }
}
