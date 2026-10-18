import { Prisma } from "@prisma/client";
import type { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A20 : MissionAssignment Foundation — Backfill historique
// contrôlé (05/10/2026).
//
// Reconstruit, pour chaque Mission legacy n'ayant ENCORE AUCUNE
// MissionAssignment, une ligne structurée représentant son `profilId`
// existant — ne retire ni ne modifie jamais `Mission.profilId` lui-même
// (reste la source legacy, inchangée, lue en parallèle par les
// consommateurs existants). Contourne volontairement
// lib/mission/assignment.ts::creerAssignmentAvecRetry : ce service protège
// la création d'une affectation VIVANTE (règles d'unicité ACTIF, statuts
// initiaux limités à PLANIFIE/ACTIF) — le backfill, lui, reconstruit un
// fait déjà réglé et clos (une Mission TERMINEE/ANNULEE l'est déjà), il ne
// fait transiter aucun état.
//
// STRATÉGIE DE DATE — CORRIGÉE (A20 DATE SEMANTICS CORRECTION, 05/10/2026) :
//
// AUCUNE source du repo ne prouve la date RÉELLE d'affectation
// opérationnelle (dateDebut) ni de fin d'affectation (dateFin) d'un
// Talent sur une Mission historique — exploré et écarté explicitement :
// Mission.dateDebut/dateFin (NULL pour 98.9%/quasi-totalité des lignes),
// JournalActivite (aucune entrée à la création d'une Mission ; ne couvre
// que 28% des transitions historiques via /transition), FeuilleDeTemps
// (0% de couverture sur les Mission TERMINEE/ANNULEE), Document type
// CONTRAT (0.8% de couverture), Evaluation (34% de couverture mais
// temporellement décorrélée de la fin réelle de l'affectation — une
// évaluation peut arriver des semaines après). `Mission.createdAt`/
// `updatedAt` restent les seuls champs TOUJOURS présents, mais ce sont des
// faits de PROVENANCE DE LA DONNÉE (quand la ligne Mission a été écrite),
// jamais des faits D'AFFECTATION (quand le Talent a réellement
// commencé/fini) — les traiter comme équivalents était une erreur de la
// version précédente de ce backfill, corrigée ici.
//
// Décision explicite (validée humainement après exploration exhaustive
// des sources alternatives, A20 Date Semantics Correction) : conserver
// `Mission.createdAt`/`updatedAt` comme MEILLEURE VALEUR DISPONIBLE pour
// satisfaire `dateDebut` (non-nullable) et la règle métier "TERMINE/ANNULE
// -> dateFin obligatoire", mais ne JAMAIS les présenter comme des faits
// certains : `dateDebutProvenance`/`dateFinProvenance` marquent chaque
// ligne backfillée PROXY_CREATION_MISSION/PROXY_DERNIERE_ECRITURE_MISSION
// — jamais CONNUE (réservée aux lignes créées par une action humaine
// réelle via lib/mission/assignment.ts). Un consommateur futur DOIT lire
// ce champ de provenance avant de traiter dateDebut/dateFin comme fiable.
//
// allocationPct = NULL (UNKNOWN explicite, contrat A20 §14 — aucune
// estimation tentée).
//
// createdByEmail = "system" (contrat A20 §15 — aucune convention
// historique différente trouvée dans le repo pour une écriture générée
// par migration).
//
// estResponsablePrincipal = true pour chaque ligne backfillée : le legacy
// `profilId` représentait, avant A20, L'UNIQUE Talent attribué à la
// Mission (aucune notion de contributeur/reviewer n'existait) — poser
// estResponsablePrincipal=true est la lecture directe de ce fait, jamais
// une invention. Ne viole jamais l'invariant d'unicité (restreint aux
// lignes ACTIF) : chaque Mission ne reçoit qu'une seule ligne backfillée.
//
// IDEMPOTENCE : avant toute insertion, vérifie qu'AUCUNE MissionAssignment
// n'existe déjà pour cette Mission (qu'elle vienne d'un run précédent de ce
// backfill ou d'une création live via l'API) — une Mission qui en possède
// déjà une est ignorée, jamais dupliquée, jamais réconciliée.

export type AnomalieBackfill = {
  missionId: string;
  raison: string;
};

export type ResultatBackfill = {
  total: number;
  deraJaBackfillees: number; // possédaient déjà au moins une MissionAssignment — ignorées.
  creees: number;
  anomalies: AnomalieBackfill[];
};

// CASE explicite sans défaut implicite (même discipline que les migrations
// Lot A/16.2) : tout statut Mission hors de cette table produit une
// anomalie rapportée, jamais un mapping devine.
function statutAssignmentPour(statutMission: StatutMission): "ACTIF" | "TERMINE" | "ANNULE" | null {
  switch (statutMission) {
    case "EN_COURS":
      return "ACTIF";
    case "TERMINEE":
      return "TERMINE";
    case "ANNULEE":
      return "ANNULE";
    default:
      return null;
  }
}

const MAX_TENTATIVES = 3;

type IssueBackfillMission = "DEJA_BACKFILLEE" | "CREEE" | { anomalie: string };

// Check-puis-insert pour UNE Mission, dans une transaction Serializable
// avec relecture DANS la transaction — jamais une vérification préalable
// hors transaction suivie d'une écriture séparée (même discipline que
// lib/mission/assignment.ts/lib/outcome/service.ts). Nécessaire même pour
// un script de backfill a priori "one-shot" : deux invocations
// concurrentes de executerBackfillAssignments() (ex. deux déploiements, ou
// deux suites de tests en parallèle appelant toutes deux cette fonction au
// même instant) ne doivent jamais produire deux lignes pour la même
// Mission — bug réellement observé et corrigé pendant la validation A20
// (voir tests/api/a20-mission-assignment.spec.ts, scénario 35).
async function backfillUneMission(tx: Prisma.TransactionClient, missionId: string): Promise<IssueBackfillMission> {
  const mission = await tx.mission.findUnique({
    where: { id: missionId },
    select: { id: true, profilId: true, statut: true, createdAt: true, updatedAt: true, assignments: { select: { id: true }, take: 1 } },
  });
  if (!mission) return { anomalie: "Mission disparue entre la lecture de la liste et le backfill (ne devrait jamais arriver)." };

  if (mission.assignments.length > 0) return "DEJA_BACKFILLEE";

  // Défensif — structurellement impossible (profilId NOT NULL, FK
  // ON DELETE RESTRICT vers Profil) mais jamais supposé sans vérifier :
  // ne jamais corriger silencieusement une incohérence de données.
  if (!mission.profilId) {
    return { anomalie: "profilId absent (ne devrait jamais arriver — contrainte NOT NULL)." };
  }
  const talent = await tx.profil.findUnique({ where: { id: mission.profilId }, select: { id: true } });
  if (!talent) {
    return { anomalie: `profilId ${mission.profilId} ne référence aucun Profil existant.` };
  }

  const statutCible = statutAssignmentPour(mission.statut);
  if (!statutCible) {
    return { anomalie: `statut Mission inattendu : ${mission.statut} — aucun mapping défini, rien inventé.` };
  }

  const estTerminal = statutCible === "TERMINE" || statutCible === "ANNULE";

  await tx.missionAssignment.create({
    data: {
      missionId: mission.id,
      talentId: mission.profilId,
      role: "RESPONSABLE_PRINCIPAL",
      statut: statutCible,
      dateDebut: mission.createdAt,
      dateDebutProvenance: "PROXY_CREATION_MISSION",
      dateFin: estTerminal ? mission.updatedAt : null,
      dateFinProvenance: estTerminal ? "PROXY_DERNIERE_ECRITURE_MISSION" : null,
      allocationPct: null,
      estResponsablePrincipal: true,
      createdByEmail: "system",
    },
  });
  return "CREEE";
}

async function backfillUneMissionAvecRetry(missionId: string): Promise<IssueBackfillMission> {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => backfillUneMission(tx, missionId), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES - 1) continue;
      throw erreur;
    }
  }
  throw new Error("ECHEC_BACKFILL_CONCURRENCE");
}

export async function executerBackfillAssignments(): Promise<ResultatBackfill> {
  const missions = await prisma.mission.findMany({ select: { id: true } });

  const anomalies: AnomalieBackfill[] = [];
  let deraJaBackfillees = 0;
  let creees = 0;

  for (const mission of missions) {
    const issue = await backfillUneMissionAvecRetry(mission.id);
    if (issue === "DEJA_BACKFILLEE") deraJaBackfillees++;
    else if (issue === "CREEE") creees++;
    else anomalies.push({ missionId: mission.id, raison: issue.anomalie });
  }

  return { total: missions.length, deraJaBackfillees, creees, anomalies };
}
