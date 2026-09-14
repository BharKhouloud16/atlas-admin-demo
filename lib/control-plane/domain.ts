import { estCorrelationIdValide } from "@/lib/strategic/domain";

// COMPANY ATLAS — B22 (14/09/2026) : AUTONOMY + DECISION + DELEGATION
// CONTROL PLANE. Vocabulaires fermés et gardes-fous purs, même discipline
// que lib/strategic/domain.ts (B21) et lib/security/domain.ts (B13) :
// jamais une exception, un booléen ; zéro score/agrégation arbitraire ;
// UNKNOWN explicite jamais déduit.
//
// correlationId — réutilise TEL QUEL estCorrelationIdValide (B21.1) :
// jamais redéfini, jamais une seconde règle de validation. ≤300 caractères
// accepté inchangé, >300 refusé (400), jamais tronqué.
export { estCorrelationIdValide };

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevelValeur = (typeof RISK_LEVELS)[number];

export function estRiskLevelValide(valeur: unknown): valeur is RiskLevelValeur {
  return typeof valeur === "string" && (RISK_LEVELS as readonly string[]).includes(valeur);
}

// Ordre total explicite — une simple table de rang fermée, utilisée
// UNIQUEMENT pour comparer un risque déclaré à un plafond déclaré
// (Delegation.maxRiskLevel). Ne calcule jamais un RiskLevel à partir
// d'autre chose : les deux valeurs comparées sont toujours des entrées
// humaines/agent, jamais un résultat de formule (directive B22, section 7).
const RANG_RISK_LEVEL: Record<RiskLevelValeur, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function risqueDepasse(risqueDemande: RiskLevelValeur, maxAutorise: RiskLevelValeur): boolean {
  return RANG_RISK_LEVEL[risqueDemande] > RANG_RISK_LEVEL[maxAutorise];
}

export const ACTION_CLASSES = ["OBSERVATION", "INTERNAL_ACTION", "EXTERNAL_ACTION", "COMMITMENT"] as const;
export type ActionClassValeur = (typeof ACTION_CLASSES)[number];

export function estActionClassValide(valeur: unknown): valeur is ActionClassValeur {
  return typeof valeur === "string" && (ACTION_CLASSES as readonly string[]).includes(valeur);
}

export const AUTONOMY_LEVELS = [
  "L0_OBSERVE",
  "L1_ANALYZE",
  "L2_RECOMMEND",
  "L3_PREPARE",
  "L4_EXECUTE_WITH_APPROVAL",
  "L5_EXECUTE_WITH_GUARDRAILS",
  "L6_AUTONOMOUS",
] as const;
export type AutonomyLevelValeur = (typeof AUTONOMY_LEVELS)[number];

export function estAutonomyLevelValide(valeur: unknown): valeur is AutonomyLevelValeur {
  return typeof valeur === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(valeur);
}

// L5/L6 existent pour compatibilité future — B22 ne peut JAMAIS les
// accorder (directive B22, section 7/12). Toute AuthorizationRequest avec
// un niveau non supporté est refusée (400) avant toute écriture.
const NIVEAUX_AUTONOMIE_SUPPORTES: readonly AutonomyLevelValeur[] = [
  "L0_OBSERVE",
  "L1_ANALYZE",
  "L2_RECOMMEND",
  "L3_PREPARE",
  "L4_EXECUTE_WITH_APPROVAL",
];

export function estAutonomyLevelSupporte(valeur: AutonomyLevelValeur): boolean {
  return (NIVEAUX_AUTONOMIE_SUPPORTES as readonly string[]).includes(valeur);
}

export const BRAND_IMPACTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "CRITICAL", "UNKNOWN"] as const;
export type BrandImpactValeur = (typeof BRAND_IMPACTS)[number];

export function estBrandImpactValide(valeur: unknown): valeur is BrandImpactValeur {
  return typeof valeur === "string" && (BRAND_IMPACTS as readonly string[]).includes(valeur);
}

export const AUTHORIZATION_DECISIONS = ["ALLOW", "APPROVAL_REQUIRED", "RESTRICT", "DENY"] as const;
export type AuthorizationDecisionValeur = (typeof AUTHORIZATION_DECISIONS)[number];

export function estAuthorizationDecisionValide(valeur: unknown): valeur is AuthorizationDecisionValeur {
  return typeof valeur === "string" && (AUTHORIZATION_DECISIONS as readonly string[]).includes(valeur);
}

export const HUMAN_NECESSITY_LEVELS = ["H0", "H1", "H2", "H3", "H4"] as const;
export type HumanNecessityLevelValeur = (typeof HUMAN_NECESSITY_LEVELS)[number];

export function estHumanNecessityLevelValide(valeur: unknown): valeur is HumanNecessityLevelValeur {
  return typeof valeur === "string" && (HUMAN_NECESSITY_LEVELS as readonly string[]).includes(valeur);
}

export const EMERGENCY_STOP_SCOPES = [
  "GLOBAL",
  "AGENT",
  "ACTION_CLASS",
  "CAPABILITY",
  "INTEGRATION",
  "DELEGATION",
  "MISSION",
] as const;
export type EmergencyStopScopeValeur = (typeof EMERGENCY_STOP_SCOPES)[number];

export function estEmergencyStopScopeValide(valeur: unknown): valeur is EmergencyStopScopeValeur {
  return typeof valeur === "string" && (EMERGENCY_STOP_SCOPES as readonly string[]).includes(valeur);
}

// B22-FIX (14/09/2026, audit P0 section 6) — sous-ensemble RÉELLEMENT
// évalué par estArreteUrgenceActif (lib/control-plane/emergency-stop.ts).
// CAPABILITY/INTEGRATION/MISSION restent déclarés dans
// EMERGENCY_STOP_SCOPES pour la complétude du vocabulaire cible, mais
// aucune donnée B22 ne représente une Capability/Integration/Mission comme
// entité — les évaluer réellement nécessiterait un registre qui n'existe
// pas dans ce lot (hors périmètre B22 : aucune architecture nouvelle
// inventée pour les couvrir). Un EmergencyStop créé avec un tel scope ne
// bloquerait donc RIEN, en donnant une fausse impression de protection —
// refusé explicitement à la création (Option B de l'audit, jamais un faux
// mécanisme de blocage), plutôt que de l'implémenter par une extension
// d'architecture hors mandat.
export const EMERGENCY_STOP_SCOPES_EVALUES = ["GLOBAL", "AGENT", "ACTION_CLASS", "DELEGATION"] as const;

export function estEmergencyStopScopeEvalueParB22(valeur: EmergencyStopScopeValeur): boolean {
  return (EMERGENCY_STOP_SCOPES_EVALUES as readonly string[]).includes(valeur);
}

// Ajout justifié (Phase 3-FIX, point 3) — nécessaire au matching
// déterministe de calculerHumanNecessity : un texte libre ne peut pas être
// filtré de façon fiable par une table de règles fermée. N'est PAS un
// score, ne produit jamais seul un ALLOW. UNKNOWN n'est jamais traité
// comme une preuve suffisante.
export const EVIDENCE_QUALITIES = ["VERIFIED", "DECLARED", "UNKNOWN"] as const;
export type EvidenceQualityValeur = (typeof EVIDENCE_QUALITIES)[number];

export function estEvidenceQualityValide(valeur: unknown): valeur is EvidenceQualityValeur {
  return typeof valeur === "string" && (EVIDENCE_QUALITIES as readonly string[]).includes(valeur);
}

const PLAFOND_CHAMP = 4000;
const PLAFOND_COURT = 300;

export function plafonnerTexteControlPlane(texte: string | null | undefined, max: number = PLAFOND_CHAMP): string | null {
  if (typeof texte !== "string" || texte.length === 0) return null;
  return texte.length > max ? texte.slice(0, max) : texte;
}

export { PLAFOND_CHAMP as PLAFOND_CHAMP_CONTROL_PLANE, PLAFOND_COURT as PLAFOND_COURT_CONTROL_PLANE };

// Confidence (Phase 3-FIX, point 4) — null accepté, sinon strictement
// dans [0.0, 1.0]. Purement déclaratif : ne transforme jamais seul une
// décision en ALLOW (aucune fonction de ce module ni d'authorization.ts
// ne lit Decision.confidence pour calculer AuthorizationDecision).
export function estConfidenceValide(valeur: number | null | undefined): boolean {
  if (valeur === null || valeur === undefined) return true;
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= 0 && valeur <= 1;
}
