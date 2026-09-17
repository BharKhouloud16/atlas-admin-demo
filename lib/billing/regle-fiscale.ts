// COMPANY ATLAS — V2.2-B : Fiscal & Regulatory Compliance Foundation.
//
// Fonctions pures de résolution d'une RegleFiscale applicable, et de
// construction du "compliance snapshot" figé sur une Facture à sa
// validation — voir prisma/schema.prisma (RegleFiscale, Facture) et le
// mandat CEO V2.2-B sections 7/8/13 ("Time-Versioned Compliance",
// "Compliance Snapshot"). Aucune règle fiscale n'est affirmée ici : ces
// fonctions ne font que choisir, parmi des RegleFiscale déjà persistées et
// explicitement ACTIVE, celle dont la fenêtre [effectiveFrom, effectiveTo)
// couvre la date demandée — jamais une décision juridique nouvelle.

export type RegleFiscaleResolue = {
  id: string;
  juridiction: string;
  version: string;
  source: string;
  parametres: unknown;
};

type RegleFiscaleCandidate = {
  id: string;
  juridiction: string;
  version: string;
  statut: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  source: string;
  parametres: unknown;
};

// Une juridiction ne doit avoir, à un instant donné, qu'AU PLUS une
// RegleFiscale ACTIVE dont la fenêtre couvre cet instant — c'est une
// invariant vérifié par lib/billing/creation.ts à l'ACTIVATION d'une
// nouvelle règle (jamais ici, une fonction de lecture pure ne doit pas
// avoir à choisir arbitrairement entre deux règles concurrentes). Si
// l'invariant est malgré tout violé, on préfère la plus récente
// (effectiveFrom le plus tardif) plutôt qu'un résultat indéterminé — mais
// ce cas doit être traité comme une anomalie de données, jamais un
// fonctionnement normal.
export function reglesApplicables(regles: RegleFiscaleCandidate[], juridiction: string, date: Date): RegleFiscaleCandidate[] {
  return regles
    .filter((r) => r.statut === "ACTIVE" && r.juridiction === juridiction)
    .filter((r) => r.effectiveFrom.getTime() <= date.getTime() && (!r.effectiveTo || date.getTime() < r.effectiveTo.getTime()))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
}

// null = UNKNOWN, explicite (voir mandat CEO section 9 : "si une exigence
// n'est pas suffisamment vérifiée -> UNKNOWN, ne jamais transformer une
// hypothèse juridique en règle métier") — jamais une règle par défaut
// inventée pour combler l'absence.
export function resoudreRegleFiscale(regles: RegleFiscaleCandidate[], juridiction: string, date: Date): RegleFiscaleResolue | null {
  const candidates = reglesApplicables(regles, juridiction, date);
  if (candidates.length === 0) return null;
  const { id, juridiction: j, version, source, parametres } = candidates[0];
  return { id, juridiction: j, version, source, parametres };
}

export type ComplianceSnapshot =
  | { statut: "RESOLU"; juridiction: string; version: string; source: string; parametres: unknown }
  | { statut: "UNKNOWN"; raison: string };

// Copie figée, jamais réévaluable après coup — voir le commentaire de
// Facture.complianceSnapshot (prisma/schema.prisma). Une Facture émise sans
// règle résolue (UNKNOWN) reste explicite sur ce point plutôt que de
// prétendre silencieusement à une conformité non vérifiée.
export function construireComplianceSnapshot(regle: RegleFiscaleResolue | null): ComplianceSnapshot {
  if (!regle) {
    return { statut: "UNKNOWN", raison: "Aucune RegleFiscale ACTIVE ne couvre cette juridiction à cette date." };
  }
  return { statut: "RESOLU", juridiction: regle.juridiction, version: regle.version, source: regle.source, parametres: regle.parametres };
}
