// ATLAS TRUST / ATLAS TALENT — Talent Trust V2 (Batch 8, 06/09/2026). Score
// de confiance EXPLICABLE pour un candidat, construit à partir de signaux
// déjà calculés par les couches existantes (Evidence Confidence, Candidate
// Intelligence, Talent Intelligence, Matching V3) — ce module ne recalcule
// AUCUN de ces signaux, il les LIT et les COMBINE en composants nommés,
// chacun avec son propre niveau et sa propre preuve.
//
// RÈGLE ABSOLUE (ordre d'exécution ATLAS, Batch 8) : jamais un score brut
// sans justification ("Trust=83") — chaque composant est explicable
// individuellement (label + niveau + preuve textuelle réelle). Déterministe,
// sans LLM, sans DB ici (fonction pure, comme le reste de lib/talent/).
// Une donnée manquante affiche INCONNUE ou, si trop de composants manquent,
// DONNEES_INSUFFISANTES — jamais une valeur inventée pour combler un vide.
//
// Portée : un Trust par PROFIL (indépendant d'une DemandeTalent précise),
// contrairement à Matching V3 (lib/talent/matching-v3.ts) qui enrichit un
// résultat de matching pour une demande donnée — les deux sont
// complémentaires, ni l'un ni l'autre ne remplace le score du Matching
// Engine V2 ni ne prend de décision (voir lib/talent/recommendation-engine.ts
// pour la seule couche qui formule une recommandation soumise à revue
// humaine).

import type { CandidateIntelligence } from "./candidate-intelligence";
import type { TalentIntelligence } from "./talent-intelligence";

export type NiveauComposantTrust = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";
export type NiveauTrustGlobal = "HAUTE" | "MOYENNE" | "BASSE" | "DONNEES_INSUFFISANTES";

export type ComposantTrust = {
  label: string;
  niveau: NiveauComposantTrust;
  evidence: string; // texte réel, dérivé des données déjà calculées — jamais fabriqué
};

export type TalentTrust = {
  profilId: string;
  // Chaque composant est indépendant et explicable seul — voir ordre
  // d'exécution ATLAS, Batch 8 : "jamais un score global sans justification".
  composants: {
    forcePreuve: ComposantTrust; // force des preuves des compétences principales (Evidence Confidence)
    provenance: ComposantTrust; // origine de la donnée : vérifiée (Admin), déclarée, ou seulement inférée
    fraicheur: ComposantTrust; // ancienneté de la preuve la plus récente
    coherence: ComposantTrust; // présence ou absence de contradictions détectées
    historiqueMissions: ComposantTrust; // volume réel de missions terminées
    historiqueEvaluations: ComposantTrust; // volume réel d'évaluations client
    completude: ComposantTrust; // proportion de zones connues vs inconnues du profil
  };
  niveauGlobal: NiveauTrustGlobal;
  explicationGlobale: string;
  avertissement: string;
};

const ORDRE: Record<NiveauComposantTrust, number> = { HAUTE: 3, MOYENNE: 2, BASSE: 1, INCONNUE: 0 };

// Composant 1 — FORCE DE PREUVE : reprend la confiance détaillée déjà
// calculée par Evidence Confidence (via Candidate Intelligence) pour les
// compétences principales, agrégée par la règle du "maillon le plus
// faible" (même règle que lib/talent/matching-v3.ts, jamais une moyenne
// pondérée qui masquerait une compétence mal étayée).
function composantForcePreuve(candidat: CandidateIntelligence): ComposantTrust {
  const principales = candidat.competences.principales;
  if (principales.length === 0) {
    return { label: "Force de preuve", niveau: "INCONNUE", evidence: "Aucune compétence identifiée sur ce profil (ni Skill Graph, ni déclaration)." };
  }
  const pire = principales.reduce((p, c) => (ORDRE[c.confianceDetaillee.confiance] < ORDRE[p.confianceDetaillee.confiance] ? c : p));
  return {
    label: "Force de preuve",
    niveau: pire.confianceDetaillee.confiance,
    evidence: `Compétence la moins étayée parmi les principales : ${pire.competence} — ${pire.confianceDetaillee.explication}`,
  };
}

// Composant 2 — PROVENANCE : origine la plus fiable parmi les compétences
// principales (VERIFIE par un Admin > DECLARE par l'ingénieur > INFERE par
// détection automatique) — jamais une moyenne, la meilleure provenance
// réelle observée, avec le décompte réel des autres statuts en preuve.
function composantProvenance(candidat: CandidateIntelligence): ComposantTrust {
  const principales = candidat.competences.principales;
  if (principales.length === 0) {
    return { label: "Provenance", niveau: "INCONNUE", evidence: "Aucune compétence à évaluer." };
  }
  const compte = { VERIFIE: 0, DECLARE: 0, INFERE: 0, INCONNU: 0 };
  for (const c of principales) compte[c.statut]++;
  const detail = `${compte.VERIFIE} vérifiée(s) par un Admin, ${compte.DECLARE} déclarée(s), ${compte.INFERE} détectée(s) automatiquement.`;
  if (compte.VERIFIE > 0) return { label: "Provenance", niveau: "HAUTE", evidence: detail };
  if (compte.DECLARE > 0) return { label: "Provenance", niveau: "MOYENNE", evidence: detail };
  if (compte.INFERE > 0) return { label: "Provenance", niveau: "BASSE", evidence: detail };
  return { label: "Provenance", niveau: "INCONNUE", evidence: detail };
}

// Composant 3 — FRAÎCHEUR : proportion de compétences principales dont la
// preuve la plus récente reste "récente" au sens déjà défini par Candidate
// Intelligence (RECENTE_SOUS_JOURS) — jamais un nouveau seuil de fraîcheur.
function composantFraicheur(candidat: CandidateIntelligence): ComposantTrust {
  const principales = candidat.competences.principales;
  if (principales.length === 0) {
    return { label: "Fraîcheur", niveau: "INCONNUE", evidence: "Aucune compétence à évaluer." };
  }
  const nombreRecentes = principales.filter((c) => c.recente).length;
  const evidence = `${nombreRecentes}/${principales.length} compétence(s) principale(s) avec une preuve récente.`;
  if (nombreRecentes === principales.length) return { label: "Fraîcheur", niveau: "HAUTE", evidence };
  if (nombreRecentes > 0) return { label: "Fraîcheur", niveau: "MOYENNE", evidence };
  return { label: "Fraîcheur", niveau: "BASSE", evidence };
}

// Composant 4 — COHÉRENCE : présence de contradictions déjà détectées par
// Candidate Intelligence (jamais un second mécanisme de détection).
function composantCoherence(candidat: CandidateIntelligence): ComposantTrust {
  if (candidat.competences.principales.length === 0 && candidat.competences.verifiees.length === 0 && candidat.competences.declarees.length === 0) {
    return { label: "Cohérence", niveau: "INCONNUE", evidence: "Aucune compétence à comparer." };
  }
  if (candidat.contradictions.length > 0) {
    return { label: "Cohérence", niveau: "BASSE", evidence: `${candidat.contradictions.length} contradiction(s) signalée(s) : ${candidat.contradictions.join(" ; ")}` };
  }
  return { label: "Cohérence", niveau: "HAUTE", evidence: "Aucune contradiction détectée entre les preuves disponibles." };
}

// Composant 5 — HISTORIQUE DE MISSIONS : volume réel de missions terminées
// (Talent Intelligence, jamais recalculé). Une mission "en cours" seule,
// sans mission terminée, reste un historique réel mais encore incomplet
// (BASSE, pas INCONNUE : la donnée existe, elle est simplement limitée).
function composantHistoriqueMissions(talent: TalentIntelligence): ComposantTrust {
  if (talent.experience.statut === "INCONNU") {
    return { label: "Historique de missions", niveau: "INCONNUE", evidence: "Aucune mission enregistrée sur ce profil." };
  }
  const e = talent.experience;
  const evidence = `${e.nombreMissions} mission(s) enregistrée(s), dont ${e.missionsTerminees} terminée(s) et ${e.missionsEnCours} en cours.`;
  if (e.missionsTerminees >= 2) return { label: "Historique de missions", niveau: "HAUTE", evidence };
  if (e.missionsTerminees === 1) return { label: "Historique de missions", niveau: "MOYENNE", evidence };
  return { label: "Historique de missions", niveau: "BASSE", evidence };
}

// Composant 6 — HISTORIQUE D'ÉVALUATIONS : volume réel d'évaluations client
// (jamais la valeur de la moyenne elle-même : le Trust évalue la fiabilité
// de la donnée, pas la qualité de la performance — voir Talent Analytics,
// Batch 9, pour l'exploitation de la performance en tant que telle).
function composantHistoriqueEvaluations(talent: TalentIntelligence): ComposantTrust {
  if (talent.performance.statut === "INCONNU") {
    return { label: "Historique d'évaluations", niveau: "INCONNUE", evidence: "Aucune évaluation client enregistrée." };
  }
  const p = talent.performance;
  const evidence = `${p.nombreEvaluations} évaluation(s) client enregistrée(s) (moyenne ${p.moyenne}/5, donnée non utilisée ici pour le niveau de confiance).`;
  if (p.nombreEvaluations >= 2) return { label: "Historique d'évaluations", niveau: "HAUTE", evidence };
  return { label: "Historique d'évaluations", niveau: "MOYENNE", evidence };
}

// Composant 7 — COMPLÉTUDE : proportion de zones renseignées vs inconnues
// du profil (Candidate Intelligence, zonesInconnues) — seuils simples et
// documentés, jamais une pondération complexe.
function composantCompletude(candidat: CandidateIntelligence): ComposantTrust {
  const nombreInconnues = candidat.zonesInconnues.length;
  const evidence = `${nombreInconnues} zone(s) non renseignée(s) sur ce profil : ${candidat.zonesInconnues.join(", ") || "aucune"}.`;
  if (nombreInconnues === 0) return { label: "Complétude", niveau: "HAUTE", evidence };
  if (nombreInconnues <= 2) return { label: "Complétude", niveau: "MOYENNE", evidence };
  if (nombreInconnues <= 4) return { label: "Complétude", niveau: "BASSE", evidence };
  return { label: "Complétude", niveau: "INCONNUE", evidence };
}

// Agrégation du niveau global : si la MAJORITÉ des composants sont INCONNUE
// (>= 4 sur 7), le profil est déclaré DONNEES_INSUFFISANTES — jamais un
// niveau HAUTE/MOYENNE/BASSE trompeur construit sur une minorité de
// signaux réels. Sinon, règle du "maillon le plus faible" appliquée
// UNIQUEMENT aux composants connus (un ou deux signaux manquants ne
// doivent pas, à eux seuls, effacer une majorité de signaux positifs).
function calculerNiveauGlobal(composants: ComposantTrust[]): NiveauTrustGlobal {
  const inconnus = composants.filter((c) => c.niveau === "INCONNUE");
  if (inconnus.length >= Math.ceil(composants.length / 2) + 1) {
    return "DONNEES_INSUFFISANTES";
  }
  const connus = composants.filter((c) => c.niveau !== "INCONNUE");
  if (connus.length === 0) return "DONNEES_INSUFFISANTES";
  const pire = connus.reduce((p, c) => (ORDRE[c.niveau] < ORDRE[p.niveau] ? c : p));
  return pire.niveau as NiveauTrustGlobal;
}

// Fonction pure centrale — combine Candidate Intelligence et Talent
// Intelligence du MÊME profil (déjà construits par l'appelant) en un Talent
// Trust explicable, composant par composant. N'appelle, ne modifie et ne
// réordonne rien de ces deux modules sources.
export function construireTalentTrust(candidat: CandidateIntelligence, talent: TalentIntelligence): TalentTrust {
  const composants = {
    forcePreuve: composantForcePreuve(candidat),
    provenance: composantProvenance(candidat),
    fraicheur: composantFraicheur(candidat),
    coherence: composantCoherence(candidat),
    historiqueMissions: composantHistoriqueMissions(talent),
    historiqueEvaluations: composantHistoriqueEvaluations(talent),
    completude: composantCompletude(candidat),
  };

  const niveauGlobal = calculerNiveauGlobal(Object.values(composants));

  const explicationGlobale =
    niveauGlobal === "DONNEES_INSUFFISANTES"
      ? "Données insuffisantes pour établir un niveau de confiance global fiable — la majorité des composants sont inconnus."
      : `Niveau global ${niveauGlobal}, déterminé par le composant le plus faible parmi ceux effectivement renseignés (voir composants ci-dessus pour le détail).`;

  return {
    profilId: candidat.profilId,
    composants,
    niveauGlobal,
    explicationGlobale,
    avertissement:
      "Talent Trust V2 — score déterministe et explicable, sans IA générative, ne remplace ni le Matching Engine ni une décision humaine.",
  };
}
