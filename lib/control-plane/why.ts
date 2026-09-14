import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B22 (14/09/2026) : WHY ENGINE.
// Aucun sous-système, aucun LLM, aucune nouvelle base de mémoire — une
// unique fonction de LECTURE qui reconstitue l'historique d'un
// correlationId en interrogeant les modèles B22 déjà existants (directive
// B22, section 15). Même principe que le chaînage correlationId déjà
// exercé par les tests B18-FIX/B21 : aucune mécanique nouvelle, une
// agrégation en lecture ordonnée par horodatage.

export async function reconstituerHistorique(correlationId: string) {
  const [decisions, decisionOptions, delegations, authorizationRequests, auditEvents] = await Promise.all([
    prisma.decision.findMany({ where: { correlationId }, orderBy: { createdAt: "asc" } }),
    prisma.decisionOption.findMany({ where: { correlationId }, orderBy: { createdAt: "asc" } }),
    prisma.delegation.findMany({ where: { correlationId }, orderBy: { createdAt: "asc" } }),
    prisma.authorizationRequest.findMany({ where: { correlationId }, orderBy: { createdAt: "asc" } }),
    prisma.auditEvent.findMany({ where: { correlationId }, orderBy: { timestamp: "asc" } }),
  ]);

  return { decisions, decisionOptions, delegations, authorizationRequests, auditEvents };
}
