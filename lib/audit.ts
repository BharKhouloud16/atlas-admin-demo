import { prisma } from "@/lib/prisma";

type ActeurRole = "ADMIN" | "INGENIEUR" | "CLIENT";

// Écrit une ligne dans le journal d'audit (voir JournalActivite dans
// prisma/schema.prisma) — utilisé pour les actions administratives
// sensibles : validation de compte, création d'un profil avec son TJM
// initial, rejet d'un CRA. Volontairement best-effort : un échec d'écriture
// du journal ne doit jamais faire échouer l'action elle-même.
//
// LOT 16.2 — CONTROL PLANE HARDENING : `correlationId` est optionnel et
// purement un passe-plat — jamais généré ici. Un appelant qui possède déjà
// un identifiant de corrélation pour l'opération en cours (typiquement
// lib/security/events.ts::nouveauCorrelationId(), même format UUID que
// EvenementSecurite) peut le transmettre pour que cette entrée
// JournalActivite participe à la même corrélation transverse ; en son
// absence, le champ reste NULL, comme pour toute entrée historique
// (rétrocompatible, aucun appelant existant à modifier).
export async function journaliser(params: {
  acteurEmail: string;
  acteurRole: ActeurRole;
  action: string;
  cible?: string;
  detail?: string;
  correlationId?: string;
}) {
  try {
    await prisma.journalActivite.create({
      data: {
        acteurEmail: params.acteurEmail,
        acteurRole: params.acteurRole,
        action: params.action,
        cible: params.cible ?? null,
        detail: params.detail ?? null,
        correlationId: params.correlationId ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] échec d'écriture du journal d'activité", e);
  }
}
