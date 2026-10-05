import type { StatutMission, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";

// COMPANY ATLAS — A22 : Mission Lifecycle Engine (05/10/2026).
//
// Matrice de transitions explicite — même discipline que
// lib/billing/etat-facture.ts::TRANSITIONS_AUTORISEES/transitionAutorisee
// (précédent direct, cité par le mandat A22 §15/§17) : une table pure,
// jamais un enchaînement de `if` ad hoc. PLANIFIEE/PRETE/BLOQUEE sont de
// NOUVEAUX états — EN_COURS/TERMINEE/ANNULEE restent exactement ce qu'ils
// étaient avant ce lot (mêmes valeurs, même sémantique, mêmes ~5900
// Missions historiques jamais réinterprétées).
export const TRANSITIONS_AUTORISEES: Record<StatutMission, StatutMission[]> = {
  PLANIFIEE: ["PRETE", "ANNULEE"],
  PRETE: ["EN_COURS", "BLOQUEE", "ANNULEE"],
  EN_COURS: ["BLOQUEE", "TERMINEE", "ANNULEE"],
  BLOQUEE: ["EN_COURS", "TERMINEE", "ANNULEE"],
  TERMINEE: [],
  ANNULEE: [],
};

export function transitionAutorisee(depuis: StatutMission, vers: StatutMission): boolean {
  return TRANSITIONS_AUTORISEES[depuis].includes(vers);
}

// Catalogue VERROUILLÉ (contrat A22 §9) — jamais étendu dans ce lot. Un
// type TypeScript + validation applicative, jamais un enum Prisma dédié :
// la raison de blocage vit dans JournalActivite.detail (voir contrat A22
// §23, "ne pas dupliquer inutilement les mécanismes d'audit"), jamais une
// nouvelle colonne Mission — même principe que Mission.dateDebut/dateFin,
// qui ne reçoivent aucune nouvelle sémantique dans ce lot (contrat A22 §22).
export const RAISONS_BLOCAGE = ["CLIENT_DEPENDENCY", "TALENT_DEPENDENCY", "TECHNICAL", "ACCESS", "EXTERNAL", "UNKNOWN"] as const;
export type RaisonBlocage = (typeof RAISONS_BLOCAGE)[number];

export function estRaisonBlocageValide(valeur: unknown): valeur is RaisonBlocage {
  return typeof valeur === "string" && (RAISONS_BLOCAGE as readonly string[]).includes(valeur);
}

export type ActionLifecycle = "rendre_prete" | "demarrer" | "bloquer" | "debloquer" | "terminer" | "annuler";

// Cible fixe par action — une action ne dépend JAMAIS du statut courant
// pour déterminer SA cible (seule la matrice ci-dessus décide si le trajet
// depuis le statut courant est permis). "demarrer" et "debloquer" ciblent
// tous deux EN_COURS mais restent des actions distinctes (préconditions
// différentes : responsable principal pour l'un, raison de résolution
// pour l'autre — contrat A22 §7/§10) — jamais fusionnées en une action
// générique qui masquerait laquelle des deux préconditions s'applique.
const CIBLE_PAR_ACTION: Record<ActionLifecycle, StatutMission> = {
  rendre_prete: "PRETE",
  demarrer: "EN_COURS",
  bloquer: "BLOQUEE",
  debloquer: "EN_COURS",
  terminer: "TERMINEE",
  annuler: "ANNULEE",
};

export type ParamsTransitionLifecycle = {
  missionId: string;
  action: ActionLifecycle;
  raison?: string; // "bloquer" — doit être l'une des RAISONS_BLOCAGE.
  raisonResolution?: string; // "debloquer" — justification libre, jamais vide.
  motif?: string; // "annuler" (toujours) / "terminer" depuis BLOQUEE (contrat A22 §11) — jamais vide dans ces cas.
  acteurEmail: string;
  acteurRole: "ADMIN"; // seul rôle autorisé (contrat A22 §18) — jamais un paramètre ouvert.
};

export type ResultatTransitionLifecycle =
  | { ok: true; mission: Prisma.MissionGetPayload<object> }
  | { ok: false; code: "MISSION_INTROUVABLE" }
  | { ok: false; code: "TRANSITION_INVALIDE"; depuis: StatutMission; vers: StatutMission }
  | { ok: false; code: "ASSIGNMENT_ACTIF_MANQUANT" }
  | { ok: false; code: "RESPONSABLE_PRINCIPAL_MANQUANT" }
  | { ok: false; code: "RAISON_BLOCAGE_MANQUANTE" }
  | { ok: false; code: "RAISON_BLOCAGE_INVALIDE" }
  | { ok: false; code: "RAISON_RESOLUTION_MANQUANTE" }
  | { ok: false; code: "MOTIF_MANQUANT" };

function texteNonVide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && valeur.trim().length > 0;
}

// COMPANY ATLAS — A22 : moteur de transition.
//
// RÈGLE ABSOLUE (contrat A22 §5) : cette fonction est le SEUL point
// d'écriture de Mission.statut après création — jamais une conséquence
// automatique d'un Assignment/CapabilityLink/WorkItem/Deliverable/
// Evidence/Quality/Outcome créé ailleurs. Elle ne lit JAMAIS, n'écrit
// JAMAIS MissionAssignment.statut ni MissionCapabilityLink.statut (deux
// machines d'état distinctes, contrat A22 §13/§14) — seulement pour LIRE
// l'existence d'un Assignment ACTIF/responsable principal comme
// PRÉCONDITION (jamais une écriture croisée).
//
// CONCURRENCE (contrat A22 §20) : même technique que
// lib/billing/transitions.ts::ecrireTransition — écriture conditionnelle
// en une seule instruction (`updateMany` avec le statut de départ observé
// en clause WHERE). Si une autre transition a changé le statut entre la
// lecture des préconditions et cette écriture, `count === 0` et la
// transition est refusée (TRANSITION_INVALIDE) au lieu d'écraser un état
// plus récent — jamais une transaction Serializable + retry ici : une
// seule ligne est lue puis écrite, jamais plusieurs lignes agrégées
// (même justification que le précédent Facture).
//
// PERFORMANCE (contrat A22 §33) : une lecture Mission par PK, zéro ou une
// requête MissionAssignment scopée à CETTE Mission (jamais un scan de
// toutes les Missions), une écriture conditionnelle par PK, un
// journaliser() — temps constant par Mission, jamais une boucle globale.
export async function executerTransitionMission(params: ParamsTransitionLifecycle): Promise<ResultatTransitionLifecycle> {
  const mission = await prisma.mission.findUnique({ where: { id: params.missionId } });
  if (!mission) return { ok: false, code: "MISSION_INTROUVABLE" };

  const statutDepart = mission.statut;
  const statutCible = CIBLE_PAR_ACTION[params.action];

  if (!transitionAutorisee(statutDepart, statutCible)) {
    return { ok: false, code: "TRANSITION_INVALIDE", depuis: statutDepart, vers: statutCible };
  }

  // Préconditions spécifiques à l'action — contrat A22 §6/§7/§9/§10/§11/§12.
  // Jamais déduites de Mission.profilId ni d'un "premier Assignment" ni de
  // l'ordre de création : toujours une requête explicite sur
  // MissionAssignment.statut/estResponsablePrincipal (A20), jamais une
  // heuristique.
  if (params.action === "rendre_prete") {
    const assignmentActif = await prisma.missionAssignment.findFirst({
      where: { missionId: params.missionId, statut: "ACTIF" },
      select: { id: true },
    });
    if (!assignmentActif) return { ok: false, code: "ASSIGNMENT_ACTIF_MANQUANT" };
  }

  if (params.action === "demarrer") {
    const responsablePrincipalActif = await prisma.missionAssignment.findFirst({
      where: { missionId: params.missionId, statut: "ACTIF", estResponsablePrincipal: true },
      select: { id: true },
    });
    if (!responsablePrincipalActif) return { ok: false, code: "RESPONSABLE_PRINCIPAL_MANQUANT" };
  }

  if (params.action === "bloquer") {
    if (!texteNonVide(params.raison)) return { ok: false, code: "RAISON_BLOCAGE_MANQUANTE" };
    if (!estRaisonBlocageValide(params.raison)) return { ok: false, code: "RAISON_BLOCAGE_INVALIDE" };
  }

  if (params.action === "debloquer") {
    // Jamais la raison de blocage initiale réutilisée silencieusement
    // comme raison de résolution (contrat A22 §10) — un champ distinct,
    // toujours explicitement fourni.
    if (!texteNonVide(params.raisonResolution)) return { ok: false, code: "RAISON_RESOLUTION_MANQUANTE" };
  }

  if (params.action === "annuler") {
    // Toujours obligatoire, quel que soit le statut de départ (contrat A22 §12).
    if (!texteNonVide(params.motif)) return { ok: false, code: "MOTIF_MANQUANT" };
  }

  if (params.action === "terminer" && statutDepart === "BLOQUEE") {
    // Obligatoire UNIQUEMENT depuis BLOQUEE (contrat A22 §11) — jamais
    // exigé depuis EN_COURS (contrat A22 §8 : aucune précondition
    // WorkItem/Deliverable/Evidence/Quality/Outcome, et aucune précondition
    // de raison non plus pour ce chemin).
    if (!texteNonVide(params.motif)) return { ok: false, code: "MOTIF_MANQUANT" };
  }

  const ecriture = await prisma.mission.updateMany({
    where: { id: params.missionId, statut: statutDepart },
    data: { statut: statutCible },
  });
  if (ecriture.count === 0) {
    // Stale : un autre appelant a déjà transitionné cette Mission entre la
    // lecture ci-dessus et cette écriture — jamais une écrasement, jamais
    // un second gagnant (contrat A22 §20).
    return { ok: false, code: "TRANSITION_INVALIDE", depuis: statutDepart, vers: statutCible };
  }

  const missionApres = await prisma.mission.findUniqueOrThrow({ where: { id: params.missionId } });

  const detailRaison = params.action === "bloquer"
    ? ` Raison : ${params.raison}.`
    : params.action === "debloquer"
      ? ` Résolution : ${params.raisonResolution}.`
      : texteNonVide(params.motif)
        ? ` Motif : ${params.motif}.`
        : "";

  await journaliser({
    acteurEmail: params.acteurEmail,
    acteurRole: params.acteurRole,
    action: "mission.lifecycle.transition",
    cible: `mission:${params.missionId}`,
    detail: `Mission ${params.missionId} : ${statutDepart} -> ${statutCible} (action "${params.action}").${detailRaison}`,
  });

  return { ok: true, mission: missionApres };
}
