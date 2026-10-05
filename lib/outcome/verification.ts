import type { OutcomeStatut, OutcomeConfiance, OutcomeMethodeVerification } from "@prisma/client";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Fonction PURE (aucun accès Prisma, aucun appel IA, aucun effet de bord)
// — même discipline que lib/client-need/coherence.ts et
// lib/finance/margin-intelligence.ts : prend des entrées déjà relues par
// l'appelant, ne décide jamais à la place d'un humain ce qu'un critère
// affirme, mais applique mécaniquement la RÈGLE ABSOLUE du rapport A6 et
// du mandat A6.1 §15/§16 : une absence de preuve ne devient JAMAIS
// OBTENU/NON_OBTENU — uniquement INDETERMINABLE.
//
// L'appelant (lib/outcome/service.ts, via la route API) fournit un statut
// PROPOSÉ par un humain (ADMIN) pour chaque critère, accompagné des
// preuves/méthodes réellement rattachées — cette fonction ne fait que
// valider la cohérence de cette proposition avec les preuves fournies
// (jamais l'inverse : elle ne invente jamais une preuve à partir d'un
// statut), puis dérive le statut global (overallStatus) par agrégation
// déterministe des critères individuels.

export type MethodeOrdonnee = OutcomeMethodeVerification;

// Ordre de force des méthodes — VERIFIE_HUMAIN et MESURE_SYSTEME sont
// toutes deux considérées "objectives/autoritaires" (confiance VERIFIE) ;
// DECLARE_CLIENT reste une déclaration non vérifiée (confiance DECLARE) ;
// INFERE_IA est la plus faible et ne peut JAMAIS, seule, suffire à
// conclure OBTENU/PARTIELLEMENT_OBTENU/NON_OBTENU (A6 §A6.10 — "AI
// inference ≠ validated fact") : un critère dont la seule méthode est
// INFERE_IA est systématiquement ramené à INDETERMINABLE, quel que soit
// le statut proposé par l'appelant.
const PRIORITE_METHODE: Record<MethodeOrdonnee, number> = {
  VERIFIE_HUMAIN: 4,
  MESURE_SYSTEME: 4,
  DECLARE_CLIENT: 2,
  INFERE_IA: 1,
};

function confianceDepuisMethode(methode: MethodeOrdonnee | null): OutcomeConfiance {
  if (methode === "VERIFIE_HUMAIN" || methode === "MESURE_SYSTEME") return "VERIFIE";
  if (methode === "DECLARE_CLIENT") return "DECLARE";
  if (methode === "INFERE_IA") return "INFERE";
  return "INCONNU";
}

function methodeDominante(methodes: MethodeOrdonnee[]): MethodeOrdonnee | null {
  if (methodes.length === 0) return null;
  return methodes.reduce((meilleure, courante) =>
    PRIORITE_METHODE[courante] > PRIORITE_METHODE[meilleure] ? courante : meilleure
  );
}

export type PreuveEnEntree = { source: string; detail?: string | null };

export type CritereEnEntree = {
  // Référence de traçabilité pure vers le ClientNeedFait(CRITERE_REUSSITE)
  // évalué — null si ce critère ne correspond à aucun fait structuré
  // (cas "critère global unique", voir service.ts).
  sourceFaitId: string | null;
  criterionText: string;
  // Statut PROPOSÉ par l'humain (ADMIN) ayant renseigné ce critère — ne
  // devient le statut final que si les preuves/méthodes fournies le
  // soutiennent réellement (voir règle absolue ci-dessus).
  statutPropose: OutcomeStatut;
  methodes: MethodeOrdonnee[];
  evidences: PreuveEnEntree[];
};

export type ResultatCritere = {
  sourceFaitId: string | null;
  criterionText: string;
  status: OutcomeStatut;
  confidence: OutcomeConfiance;
  verificationMethod: MethodeOrdonnee | null;
  evidences: PreuveEnEntree[];
};

export type ResultatVerification = {
  overallStatus: OutcomeStatut;
  criteria: ResultatCritere[];
};

function verifierCritere(entree: CritereEnEntree): ResultatCritere {
  // RÈGLE ABSOLUE (mandat A6.1 §15) : aucune preuve => jamais
  // OBTENU/PARTIELLEMENT_OBTENU/NON_OBTENU, quel que soit le statut
  // proposé par l'appelant — l'absence de preuve EST représentée par
  // INDETERMINABLE, jamais par une conclusion inventée.
  if (entree.evidences.length === 0) {
    return {
      sourceFaitId: entree.sourceFaitId,
      criterionText: entree.criterionText,
      status: "INDETERMINABLE",
      confidence: "INCONNU",
      verificationMethod: null,
      evidences: [],
    };
  }

  const methode = methodeDominante(entree.methodes);

  // Aucune méthode de vérification associée malgré une preuve présente —
  // la preuve existe mais sa provenance n'est pas qualifiée : jamais
  // assez pour conclure (même logique que ci-dessus, cas plus rare).
  if (methode === null) {
    return {
      sourceFaitId: entree.sourceFaitId,
      criterionText: entree.criterionText,
      status: "INDETERMINABLE",
      confidence: "INCONNU",
      verificationMethod: null,
      evidences: entree.evidences,
    };
  }

  const confidence = confianceDepuisMethode(methode);

  // L'IA seule ne peut jamais suffire à conclure OBTENU/PARTIELLEMENT_
  // OBTENU/NON_OBTENU (A6 §A6.10) — ramené à INDETERMINABLE quel que soit
  // le statut proposé.
  if (methode === "INFERE_IA") {
    return {
      sourceFaitId: entree.sourceFaitId,
      criterionText: entree.criterionText,
      status: "INDETERMINABLE",
      confidence,
      verificationMethod: methode,
      evidences: entree.evidences,
    };
  }

  return {
    sourceFaitId: entree.sourceFaitId,
    criterionText: entree.criterionText,
    status: entree.statutPropose,
    confidence,
    verificationMethod: methode,
    evidences: entree.evidences,
  };
}

// Agrégation déterministe du statut global à partir des critères
// individuels déjà vérifiés ci-dessus — jamais une moyenne, jamais un
// score : une règle explicable (mandat A6.1 §16 "déterministe, testable,
// explicable").
function agregerStatutGlobal(criteres: ResultatCritere[]): OutcomeStatut {
  if (criteres.length === 0) return "INDETERMINABLE";

  const statuts = criteres.map((c) => c.status);
  const auMoinsUnNonObtenu = statuts.some((s) => s === "NON_OBTENU");

  if (auMoinsUnNonObtenu) {
    return statuts.every((s) => s === "NON_OBTENU") ? "NON_OBTENU" : "PARTIELLEMENT_OBTENU";
  }
  if (statuts.some((s) => s === "INDETERMINABLE")) return "INDETERMINABLE";
  return "OBTENU";
}

export function verifierResultatVsNeed(criteresEnEntree: CritereEnEntree[]): ResultatVerification {
  const criteria = criteresEnEntree.map(verifierCritere);
  return { overallStatus: agregerStatutGlobal(criteria), criteria };
}
