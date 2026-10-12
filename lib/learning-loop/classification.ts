import type { LearningConfidence, LearningProvenance, LearningType } from "@prisma/client";
import type { PalierPreuve, PointeurFait } from "@/lib/ai/provider";
import type { DossierFaits } from "./facts";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Classification DÉTERMINISTE, revalidée server-side à chaque candidat
// (contrat A34 §9/§16/§17/§18) — l'AiProvider ne fait jamais autorité sur
// type/provenance/confidence/scope, quelle que soit sa suggestion : ce
// module recalcule TOUJOURS ces quatre valeurs depuis le dossier factuel
// réel et les règles verrouillées ci-dessous.

// --- PROVENANCE --------------------------------------------------------
// Mapping EXACT depuis le palier de preuve déjà porté par la source
// (contrat A34 §8) — jamais une promotion (DECLARATION ne devient jamais
// VERIFIED) ni une dégradation arbitraire. INFERENCE (Evidence
// INFERENCE_IA/INFERE, ou NeedFact INFERE) devient toujours INFERRED,
// jamais promue même après une validation Admin ultérieure du Learning
// (A30 §3.2, "aucune promotion automatique" — inchangé par A34).
const PALIER_VERS_PROVENANCE: Record<PalierPreuve, LearningProvenance> = {
  RAW_DATA: "OBSERVED",
  BUSINESS_FACT: "OBSERVED",
  VERIFIED_RESULT: "VERIFIED",
  DECLARATION: "DECLARED",
  INFERENCE: "INFERRED",
};

export function determinerProvenance(pointeurFaitPrincipal: PointeurFait): LearningProvenance {
  return PALIER_VERS_PROVENANCE[pointeurFaitPrincipal.palier];
}

// --- TYPE ---------------------------------------------------------------
// Vocabulaire fermé A30, règles de dérivation A34 §9 : PATTERN/
// BEST_PRACTICE/ANTI_PATTERN exigent TOUJOURS ≥2 Missions comparables
// (contrat A34 §10) — jamais déduits d'une Mission seule, quelle que soit
// la confiance de l'IA.
//
// A35.1-FIX (contrat A35 F3, audit A35) : le provider reste PUREMENT
// advisory — "provider suggestion ≠ server classification". La suggestion
// "RECOMMENDATION" du provider disposait d'un chemin privilégié qui
// contournait intégralement les règles ci-dessous ; un provider futur
// aurait pu ainsi imposer le type final d'un Learning par simple
// auto-déclaration, sans aucune vérification serveur — exactement le même
// défaut de principe que le bypass VERIFIED_RESULT du garde-fou causal
// (contrat A34 P0.2). Ce chemin est supprimé : "typeSuggere" n'influence
// plus jamais la valeur retournée, quelle qu'elle soit. Paramètre conservé
// dans la signature pour compatibilité des appelants existants (voir
// engine.ts) mais plus jamais lu.
export type SignalResultat = { positif: boolean | null }; // null = non déterminable

export function determinerType(
  missionsComparablesCount: number,
  signal: SignalResultat,
  typeSuggere: LearningType
): LearningType {
  if (missionsComparablesCount >= 2) {
    if (signal.positif === true) return "BEST_PRACTICE";
    if (signal.positif === false) return "ANTI_PATTERN";
    return "PATTERN";
  }

  // Mission seule : LESSON (fait/enseignement clair) si un signal jugé
  // existe, sinon INSIGHT (interprétation prudente) — jamais PATTERN/
  // BEST_PRACTICE/ANTI_PATTERN (contrat A34 §10, "ne crée jamais un
  // PATTERN à partir d'une seule Mission").
  return signal.positif !== null ? "LESSON" : "INSIGHT";
}

// --- CONFIDENCE -----------------------------------------------------------
// Jamais un score numérique (contrat A34 §16). La confianceSuggeree du
// provider n'est jamais lue ici (voir engine.ts) — purement advisory,
// jamais autoritaire.
//
// A35.5-FIX (contrat A35 F2, audit A35.4) : un UNIQUE fait VERIFIED_RESULT
// isolé (ni récidive F4 ≥2, ni convergence d'un second fait VERIFIED_RESULT
// dans le MÊME dossier) ne doit plus jamais produire MEDIUM — seule une
// répétabilité démontrée (récidive F4, déjà expurgée des Missions
// contradictoires, voir recurrence.ts) OU une convergence d'AU MOINS DEUX
// faits VERIFIED_RESULT distincts dans le dossier de la Mission courante
// justifie MEDIUM. HIGH exige les deux dimensions simultanément (récidive
// ≥2 ET (palier principal VERIFIED_RESULT OU convergence ≥2)). "Faits
// distincts" = pointeurs (sourceType,id) distincts du dossier (jamais une
// même ligne comptée deux fois — voir facts.ts, chaque pointeur pointe
// vers une ligne Prisma réelle et unique).
export function determinerConfidence(missionsComparablesCount: number, palierPrincipal: PalierPreuve, nombreFaitsVerifies: number): LearningConfidence {
  const convergence = nombreFaitsVerifies >= 2;
  if (missionsComparablesCount >= 2 && (palierPrincipal === "VERIFIED_RESULT" || convergence)) return "HIGH";
  if (missionsComparablesCount >= 2 || convergence) return "MEDIUM";
  return "LOW";
}

// Convergence DÉTERMINISTE (contrat A35 F2) : nombre de pointeurs distincts
// du dossier factuel portant eux-mêmes le palier VERIFIED_RESULT — jamais
// un embedding/une similarité sémantique, uniquement un comptage direct
// sur les paliers déjà attribués par facts.ts (contrat A34 §8, inchangé).
export function compterFaitsVerifies(pointeurs: PointeurFait[]): number {
  return pointeurs.filter((p) => p.palier === "VERIFIED_RESULT").length;
}

// --- SIGNAL (positif/négatif/non déterminable) --------------------------
// Dérivé UNIQUEMENT d'Outcome=OBTENU/NON_OBTENU ou FinancialResult=
// PROFIT/LOSS (contrat A34 §9) — jamais une déduction depuis Quality/
// Evidence/WorkItem seuls (signaux trop faibles pour porter BEST_PRACTICE/
// ANTI_PATTERN, contrat A34 §7).
export function deriverSignalResultat(dossier: DossierFaits): SignalResultat {
  if (dossier.outcomeStatut === "OBTENU") return { positif: true };
  if (dossier.outcomeStatut === "NON_OBTENU") return { positif: false };
  if (dossier.financialResultGlobal === "PROFIT") return { positif: true };
  if (dossier.financialResultGlobal === "LOSS") return { positif: false };
  return { positif: null };
}

// --- SCOPE ---------------------------------------------------------------
// Toujours MISSION dans A34 (contrat A34 §15) — le serveur écrase
// systématiquement toute autre valeur suggérée, jamais une exception.
export function determinerScope(): "MISSION" {
  return "MISSION";
}

// --- CAUSALITÉ --------------------------------------------------------
// Garde-fou textuel (contrat A34 §11) : reformule (jamais ne rejette,
// voir engine.ts) tout statement contenant un vocabulaire causal
// explicite. Ne bloque jamais une formulation prudente ("association
// observée entre...") — uniquement les affirmations causales directes.
//
// A34-P0.2-FIX (audit A35.1, NO-GO) : la détection s'applique désormais
// QUEL QUE SOIT le palier de preuve, y compris VERIFIED_RESULT. Un palier
// VERIFIED_RESULT prouve que le FAIT/résultat rapporté par la source est
// vérifié — il ne prouve jamais que la relation causale énoncée dans le
// `statement` (texte libre, potentiellement recopié verbatim depuis un
// champ métier comme DeliveryEvidence.contenu, voir facts.ts/provider.ts)
// est elle-même démontrée. Tant qu'aucun mécanisme explicite de preuve
// causale n'existe dans le système, toute affirmation causale détectée
// est traitée comme non démontrée, même si le fait qui la porte est
// VERIFIED_RESULT. `palierPrincipal` est conservé dans la signature pour
// compatibilité contractuelle (appelants existants, voir engine.ts) mais
// ne conditionne plus aucun bypass.
//
// A34-P0-FIX (audit A35) : normalisation LOCALE dédiée EXCLUSIVEMENT à
// cette détection — jamais appliquée au texte persisté (le `statement`
// original, non normalisé, reste ce qui est éventuellement préfixé puis
// stocké, voir engine.ts). Nécessaire car JS ne traite pas les
// caractères accentués comme des caractères de mot par défaut : un `\b`
// juste après "causé"/"entraîné" échouait silencieusement (frontière
// rompue par l'accent), et "entra[iî]ne" ne couvrait jamais le participe
// passé "entraîné" (lettres finales "né" ≠ motif "ne"). Après
// normalisation (minuscules + accents retirés + espaces réduits), ce
// bug de frontière Unicode disparaît structurellement — plus besoin de
// classe de caractères accentués dans le motif lui-même.
function normaliserPourDetectionCausale(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const VOCABULAIRE_CAUSAL = /\b(grace (?:a|au|aux)|a causee?|cause[ r]|est (?:la|une) cause|entraine|provoque|est responsable de)\b/;

export function contientAffirmationCausaleNonJustifiee(statement: string, palierPrincipal: PalierPreuve): boolean {
  return VOCABULAIRE_CAUSAL.test(normaliserPourDetectionCausale(statement));
}
