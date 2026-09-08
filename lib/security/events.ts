import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Écrit un événement de sécurité TRANSVERSE (voir EvenementSecurite,
// prisma/schema.prisma) : acteur, action, ressource, contexte, résultat,
// timestamp, severite, correlationId — le socle demandé par la directive
// B16, section 3. Distinct de journaliser() (lib/audit.ts, inchangé) qui
// reste dédié aux actions métier déjà accomplies (JournalActivite) : ici on
// trace aussi les ÉCHECS et REFUS (connexion échouée, accès RBAC refusé),
// ce que JournalActivite ne fait pas.
//
// RÈGLES (héritées de lib/audit.ts et de la directive B16, section 10 "ne
// jamais exposer... secrets/mots de passe/données sensibles dans
// logs/rapports") :
// - Best-effort : un échec d'écriture ne doit JAMAIS faire échouer l'action
//   réelle (même discipline que journaliser()).
// - `detail` est un texte court, plafonné, et ne doit JAMAIS contenir un
//   mot de passe, un token, un secret ou une stack trace — c'est à
//   l'appelant de ne jamais y passer une valeur sensible ; ce module
//   plafonne la longueur en dernier recours mais ne peut pas deviner qu'une
//   valeur est un secret : la responsabilité reste aux points d'appel.

export type ResultatEvenement = "SUCCES" | "REFUSE" | "ERREUR";
export type SeveriteEvenement = "INFO" | "ATTENTION" | "ALERTE";

// Vocabulaire fermé des actions actuellement émises — évite les chaînes
// libres non contrôlées qui rendraient les signaux (B16.3) impossibles à
// interpréter de façon fiable. Extensible par un futur lot explicite,
// jamais au fil de l'eau dans une route isolée.
export const ACTIONS_EVENEMENT_SECURITE = [
  "auth.login.succes",
  "auth.login.echec",
  "auth.login.compte_verrouille",
  "auth.login.limite_ip",
  "auth.login.totp_requis",
  "auth.login.totp_invalide",
  "auth.login.email_non_verifie",
  "auth.login.compte_inactif",
  "rbac.acces_refuse",
  "contrat.generation",
] as const;
export type ActionEvenementSecurite = (typeof ACTIONS_EVENEMENT_SECURITE)[number];

export function nouveauCorrelationId(): string {
  return randomUUID();
}

const PLAFOND_DETAIL = 500;

export async function enregistrerEvenementSecurite(params: {
  correlationId?: string;
  acteurEmail?: string | null;
  acteurRole?: Role | null;
  acteurId?: string | null;
  action: ActionEvenementSecurite;
  ressourceType?: string;
  ressourceId?: string;
  contexteIp?: string;
  contexteRoute?: string;
  resultat: ResultatEvenement;
  severite?: SeveriteEvenement;
  detail?: string;
}): Promise<void> {
  try {
    await prisma.evenementSecurite.create({
      data: {
        correlationId: params.correlationId ?? nouveauCorrelationId(),
        acteurEmail: params.acteurEmail ?? null,
        acteurRole: params.acteurRole ?? null,
        acteurId: params.acteurId ?? null,
        action: params.action,
        ressourceType: params.ressourceType ?? null,
        ressourceId: params.ressourceId ?? null,
        contexteIp: params.contexteIp ?? null,
        contexteRoute: params.contexteRoute ?? null,
        resultat: params.resultat,
        severite: params.severite ?? "INFO",
        detail: params.detail ? params.detail.slice(0, PLAFOND_DETAIL) : null,
      },
    });
  } catch (e) {
    // Best-effort — jamais bloquant, même logique que lib/audit.ts.
    console.error("[security-events] échec d'écriture de l'événement de sécurité", e);
  }
}
