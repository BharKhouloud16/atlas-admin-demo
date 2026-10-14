import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A26 : DeliveryEvidence Foundation (05/10/2026).
//
// Résolution d'appartenance partagée entre les deux routes (WorkItem/
// DeliverableVersion) — jamais dupliquée (contrat A26 §50). Ces fonctions
// ne décident JAMAIS seules d'une autorisation RBAC (pas de vérification
// de session.role ici) : elles répondent uniquement à "ce Profil/Client
// est-il propriétaire de cette ressource ?", à charge de la route de
// décider quoi faire du résultat (403/404 selon le contexte).
//
// INGÉNIEUR SUR WORKITEM (contrat A26 §33/§34) : utilise la chaîne
// métier précise WorkItem -> WorkItemAssignment -> MissionAssignment ->
// Talent (A24) — JAMAIS le raccourci Mission.profilId (legacy, pré-A20),
// qui ne reflète que "le Talent historique de la Mission entière", pas
// "qui est réellement affecté à CE WorkItem précis". Toute
// WorkItemAssignment compte, quel que soit son statut (PLANIFIE/ACTIF/
// TERMINE/ANNULE) : la question posée est "cet Ingénieur a-t-il déjà été
// affecté à ce WorkItem ?", pas "est-il actif aujourd'hui" — une Evidence
// documente un fait historique, jamais limitée à l'affectation du jour.
export async function estIngenieurAutoriseSurWorkItem(workItemId: string, profilId: string | null): Promise<boolean> {
  if (!profilId) return false;
  const assignment = await prisma.workItemAssignment.findFirst({
    where: { workItemId, missionAssignment: { talentId: profilId } },
    select: { id: true },
  });
  return !!assignment;
}

// Repli pour DeliverableVersion (contrat A26 §33, pas de chaîne
// WorkItemAssignment équivalente pour Deliverable dans ce lot — A25 n'a
// introduit aucune affectation précise par Deliverable) : même convention
// que lib/deliverable/deliverable.ts (A25) et app/api/missions/[id]/
// skill-proposals/route.ts (Phase 2B-1) — Mission.profilId reste la seule
// relation disponible à ce niveau.
export async function estIngenieurAutoriseSurMission(missionId: string, profilId: string | null): Promise<boolean> {
  if (!profilId) return false;
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { profilId: true } });
  return !!mission && mission.profilId === profilId;
}

export async function estClientAutoriseSurMission(missionId: string, clientId: string | null): Promise<boolean> {
  if (!clientId) return false;
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { clientId: true } });
  return !!mission && mission.clientId === clientId;
}
