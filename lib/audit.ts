import { prisma } from "@/lib/prisma";

type ActeurRole = "ADMIN" | "INGENIEUR" | "CLIENT";

// Écrit une ligne dans le journal d'audit (voir JournalActivite dans
// prisma/schema.prisma) — utilisé pour les actions administratives
// sensibles : validation de compte, création d'un profil avec son TJM
// initial, rejet d'un CRA. Volontairement best-effort : un échec d'écriture
// du journal ne doit jamais faire échouer l'action elle-même.
export async function journaliser(params: {
  acteurEmail: string;
  acteurRole: ActeurRole;
  action: string;
  cible?: string;
  detail?: string;
}) {
  try {
    await prisma.journalActivite.create({
      data: {
        acteurEmail: params.acteurEmail,
        acteurRole: params.acteurRole,
        action: params.action,
        cible: params.cible ?? null,
        detail: params.detail ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] échec d'écriture du journal d'activité", e);
  }
}
