import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { envoyerEmailCompteValide, envoyerEmailCompteRefuse, envoyerEmailInformationsDemandees } from "@/lib/email";
import type { EngineerAccessDecisionType } from "@prisma/client";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Centralise les 3 décisions ADMIN possibles sur une candidature (contrat
// §14). APPROUVER reproduit EXACTEMENT l'écriture qui existait déjà avant
// ce lot (`actif: true, valideLe`, voir l'ancien contenu de
// app/api/comptes/route.ts PATCH) — jamais une deuxième logique
// d'approbation parallèle. REFUSER/DEMANDER_INFORMATIONS ne touchent
// JAMAIS `actif` : le compte reste tel qu'il est, seule une ligne
// EngineerAccessDecision (append-only) trace la décision.

export class RaisonRequiseError extends Error {
  constructor() {
    super("RAISON_REQUISE");
  }
}

export class UtilisateurIntrouvableError extends Error {
  constructor() {
    super("UTILISATEUR_INTROUVABLE");
  }
}

const ACTIONS_JOURNAL: Record<EngineerAccessDecisionType, string> = {
  APPROUVER: "validation_compte",
  REFUSER: "refus_compte",
  DEMANDER_INFORMATIONS: "demande_informations_compte",
};

export type DecisionAccesParams = {
  userId: string;
  decision: EngineerAccessDecisionType;
  raison?: string | null;
  decidedByEmail: string;
};

export async function enregistrerDecisionAcces(params: DecisionAccesParams) {
  const raison = params.raison?.trim() || null;
  // Obligatoire pour REFUSER/DEMANDER_INFORMATIONS — jamais pour APPROUVER
  // (contrat §14 : "une raison/commentaire doit être conservé" pour ces
  // deux décisions uniquement).
  if (params.decision !== "APPROUVER" && !raison) {
    throw new RaisonRequiseError();
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    include: { profil: true, client: true },
  });
  if (!user) throw new UtilisateurIntrouvableError();

  if (params.decision === "APPROUVER") {
    await prisma.user.update({ where: { id: user.id }, data: { actif: true, valideLe: new Date() } });
  }

  await prisma.engineerAccessDecision.create({
    data: {
      userId: user.id,
      decision: params.decision,
      raison,
      decidedByEmail: params.decidedByEmail,
    },
  });

  const nom = user.role === "INGENIEUR" ? user.profil?.nom : user.client?.nom;
  if (nom) {
    if (params.decision === "APPROUVER") {
      await envoyerEmailCompteValide({ to: user.email, nom, role: user.role === "INGENIEUR" ? "INGENIEUR" : "CLIENT" });
    } else if (params.decision === "REFUSER") {
      await envoyerEmailCompteRefuse({ to: user.email, nom, raison: raison! });
    } else {
      await envoyerEmailInformationsDemandees({ to: user.email, nom, raison: raison! });
    }
  }

  await journaliser({
    acteurEmail: params.decidedByEmail,
    acteurRole: "ADMIN",
    action: ACTIONS_JOURNAL[params.decision],
    cible: user.id,
    detail: `Compte ${user.role} (${user.email}) — décision ${params.decision}${raison ? ` (${raison})` : ""}.`,
  });

  return { ok: true };
}
