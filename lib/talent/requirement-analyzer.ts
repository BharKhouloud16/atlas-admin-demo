// ATLAS LOT 15.5 — Client Requirement Builder : transforme un besoin
// exprimé par le Client (texte libre OU critères guidés) en une seule
// représentation structurée, "RequirementStructure", consommée ensuite par
// le même Matching Engine V2 (lib/talent/matching.ts, jamais dupliqué).
//
// Réutilise l'intégration Anthropic déjà présente dans ATLAS (même appel
// HTTP, même modèle, même discipline "jamais bloquant" que
// lib/cv-extraction.ts) — aucune seconde architecture IA créée. Sans
// ANTHROPIC_API_KEY (comme en local/CI, voir tests/unit/cv-extraction.spec.ts
// pour la même limitation documentée), retombe sur une heuristique locale
// déterministe qui réutilise lib/talent/skill-resolution.ts (déjà utilisée
// par lib/ai/provider.ts) — jamais une seconde implémentation de la
// détection de compétences.
//
// RÈGLE ANTI-HALLUCINATION (absolue) : un champ non détecté avec certitude
// reste `null`/tableau vide et est listé dans `champsInconnus` — jamais une
// valeur inventée. Une compétence retenue doit appartenir à la liste fermée
// TOUTES_COMPETENCES (même contrainte que lib/ai/provider.ts, nécessaire
// pour que le Matching Engine compare des chaînes exactes) ; toute
// compétence hors liste renvoyée par l'IA est silencieusement écartée,
// jamais inventée ni approximée.
import { resoudreCompetencesDepuisTexte } from "@/lib/talent/skill-resolution";
import { TOUTES_COMPETENCES } from "@/lib/competences";

export type PrioriteCritere = "REQUIRED" | "PREFERRED" | "OPTIONAL";

export type CritereRequirement = { valeur: string; priorite: PrioriteCritere };

export type RequirementStructure = {
  role: string | null;
  experienceMinAnnees: number | null;
  skills: CritereRequirement[];
  certifications: CritereRequirement[];
  disponibilite: string | null;
  localisation: string | null;
  domaine: string | null;
  contraintes: string[];
  // Liste des champs pour lesquels aucune information fiable n'a pu être
  // établie (ni par l'IA, ni par l'heuristique locale) — jamais comblé par
  // une valeur par défaut qui ferait croire à une correspondance positive.
  champsInconnus: string[];
  provider: "anthropic" | "local" | "guided";
  confiance: number; // 0-1 — jamais 1.0 pour un provider heuristique/IA (seul "guided" peut l'être : ce sont les mots du Client lui-même)
};

const CHAMPS_BASE = ["role", "experienceMinAnnees", "disponibilite", "localisation", "domaine"] as const;

function competencesValides(candidats: unknown): string[] {
  if (!Array.isArray(candidats)) return [];
  const ensemble = new Set(TOUTES_COMPETENCES);
  return candidats
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter((c) => ensemble.has(c));
}

// Heuristique locale, sans clé API — même esprit que
// lib/ai/provider.ts::AiProviderLocal.extraireBesoin (mots-clés/regex
// explicites uniquement, jamais de déduction). Les compétences détectées
// sont classées REQUIRED par défaut : c'est une proposition, le Client la
// corrige à l'étape de validation (Partie E du mandat) avant tout matching.
function analyserLocalement(description: string): RequirementStructure {
  const detail = resoudreCompetencesDepuisTexte(description, TOUTES_COMPETENCES);
  const skills: CritereRequirement[] = detail.map((d) => ({ valeur: d.competence, priorite: "REQUIRED" }));

  const normalise = description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  const matchExperience = normalise.match(/(\d{1,2})\s*(ans?|annees?)\s+d[' ]experience/);
  const experienceMinAnnees = matchExperience ? Number(matchExperience[1]) : null;

  const disponibilite = /(immediat|des que possible|au plus vite|rapidement)/.test(normalise)
    ? "Disponible immédiatement"
    : null;

  const champsInconnus: string[] = [...CHAMPS_BASE].filter((champ) => {
    if (champ === "experienceMinAnnees") return experienceMinAnnees == null;
    if (champ === "disponibilite") return disponibilite == null;
    return true; // role/localisation/domaine : jamais détectés par cette heuristique volontairement minimale
  });
  if (skills.length === 0) champsInconnus.push("skills");

  return {
    role: null,
    experienceMinAnnees,
    skills,
    certifications: [],
    disponibilite,
    localisation: null,
    domaine: null,
    contraintes: [],
    champsInconnus,
    provider: "local",
    confiance: skills.length > 0 ? 0.35 : 0.15,
  };
}

const MODELE_IA = "claude-haiku-4-5-20251001";

// Parsing défensif de la réponse Anthropic : chaque champ est vérifié
// individuellement (type, appartenance à la liste fermée pour les
// compétences) — un champ absent ou mal formé rejoint `champsInconnus`,
// jamais une valeur substituée. `priorite` retombe sur "REQUIRED" si absente
// ou invalide (comportement le plus prudent : mieux vaut un critère traité
// comme obligatoire par erreur — filtré plus strictement — qu'un critère
// obligatoire silencieusement dégradé en préférence).
function normaliserCriteres(bruts: unknown, competencesFermees: boolean): CritereRequirement[] {
  if (!Array.isArray(bruts)) return [];
  const ensemble = competencesFermees ? new Set(TOUTES_COMPETENCES) : null;
  const resultat: CritereRequirement[] = [];
  for (const item of bruts) {
    if (!item || typeof item !== "object") continue;
    const valeur = typeof (item as any).valeur === "string" ? (item as any).valeur.trim() : null;
    if (!valeur) continue;
    if (ensemble && !ensemble.has(valeur)) continue; // jamais une compétence hors liste fermée
    const prioriteBrute = (item as any).priorite;
    const priorite: PrioriteCritere =
      prioriteBrute === "PREFERRED" || prioriteBrute === "OPTIONAL" || prioriteBrute === "REQUIRED" ? prioriteBrute : "REQUIRED";
    resultat.push({ valeur, priorite });
  }
  return resultat;
}

function parserReponseAnthropic(objet: any): RequirementStructure {
  const champsInconnus: string[] = [];
  const role = typeof objet?.role === "string" && objet.role.trim() ? objet.role.trim() : null;
  if (!role) champsInconnus.push("role");

  const experienceMinAnnees =
    typeof objet?.experienceMinAnnees === "number" && Number.isFinite(objet.experienceMinAnnees) ? objet.experienceMinAnnees : null;
  if (experienceMinAnnees == null) champsInconnus.push("experienceMinAnnees");

  const disponibilite = typeof objet?.disponibilite === "string" && objet.disponibilite.trim() ? objet.disponibilite.trim() : null;
  if (!disponibilite) champsInconnus.push("disponibilite");

  const localisation = typeof objet?.localisation === "string" && objet.localisation.trim() ? objet.localisation.trim() : null;
  if (!localisation) champsInconnus.push("localisation");

  const domaine = typeof objet?.domaine === "string" && objet.domaine.trim() ? objet.domaine.trim() : null;
  if (!domaine) champsInconnus.push("domaine");

  const skills = normaliserCriteres(objet?.skills, true);
  if (skills.length === 0) champsInconnus.push("skills");

  const certifications = normaliserCriteres(objet?.certifications, false);

  const contraintes = Array.isArray(objet?.contraintes)
    ? objet.contraintes.filter((c: unknown): c is string => typeof c === "string" && c.trim() !== "")
    : [];

  const confianceBrute = typeof objet?.confiance === "number" ? objet.confiance : 0.5;
  const confiance = Math.max(0, Math.min(0.9, confianceBrute)); // jamais 1.0 pour un provider IA

  return { role, experienceMinAnnees, skills, certifications, disponibilite, localisation, domaine, contraintes, champsInconnus, provider: "anthropic", confiance };
}

// Analyse le texte libre du Client et propose un RequirementStructure —
// NE PERSISTE RIEN : c'est une suggestion que le Client doit explicitement
// valider (voir PATCH .../besoin) avant tout matching, exactement comme
// lib/talent/analyseur.ts pour la DemandeTalent existante (Admin-only).
// Best-effort : une panne du provider IA retombe sur l'heuristique locale,
// jamais une erreur remontée au Client.
export async function analyserBesoinLibre(description: string): Promise<RequirementStructure> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return analyserLocalement(description);

  const listeCompetences = TOUTES_COMPETENCES.join(", ");
  const prompt = `Tu analyses un besoin de recrutement exprimé en langage naturel par un client d'une plateforme de staffing IT. Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de cette forme exacte :
{"role": string ou null, "experienceMinAnnees": nombre ou null, "skills": [{"valeur": string, "priorite": "REQUIRED"|"PREFERRED"|"OPTIONAL"}], "certifications": [{"valeur": string, "priorite": "REQUIRED"|"PREFERRED"|"OPTIONAL"}], "disponibilite": string ou null, "localisation": string ou null, "domaine": string ou null, "contraintes": [string], "confiance": nombre entre 0 et 0.9}

RÈGLES STRICTES :
- Ne JAMAIS inventer une information absente du texte : si une information n'est pas explicitement présente, mets null (ou tableau vide).
- "skills" : uniquement des valeurs choisies EXACTEMENT dans cette liste fermée, jamais une autre : ${listeCompetences}
- Classe chaque compétence/certification en REQUIRED (explicitement exigée), PREFERRED (souhaitée mais pas bloquante) ou OPTIONAL (mentionnée comme un bonus).
- N'invente jamais de certification, de disponibilité ou de localisation non mentionnée.
- "confiance" doit refléter honnêtement le degré de certitude, jamais 1.0.

Texte du client à analyser :
"""
${description}
"""`;

  try {
    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE_IA,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!reponse.ok) {
      const corpsErreur = await reponse.text().catch(() => "(corps illisible)");
      console.error(`[requirement-analyzer] Réponse non-OK de l'API Anthropic : ${reponse.status} ${reponse.statusText} — ${corpsErreur}`);
      return analyserLocalement(description);
    }

    const donnees = await reponse.json();
    const texte: string | undefined = donnees?.content?.[0]?.text;
    if (!texte) {
      console.error("[requirement-analyzer] Pas de texte dans la réponse Anthropic.");
      return analyserLocalement(description);
    }

    const debut = texte.indexOf("{");
    const fin = texte.lastIndexOf("}");
    const brut = debut !== -1 && fin !== -1 ? texte.slice(debut, fin + 1) : texte;
    const objet = JSON.parse(brut);
    return parserReponseAnthropic(objet);
  } catch (e: any) {
    console.error("[requirement-analyzer] Échec de l'analyse IA, repli sur l'heuristique locale :", e?.message ?? e);
    return analyserLocalement(description);
  }
}

// Mode "critères guidés" (Partie B, Mode 2) — jamais d'appel IA : le Client
// choisit lui-même chaque critère, la confiance est donc maximale (1.0) et
// aucune extraction n'est nécessaire. Reproduit exactement la même forme
// RequirementStructure que le mode texte libre, pour que les deux modes
// convergent vers le même moteur de matching (Partie C).
export function construireRequirementDepuisCriteresGuides(input: {
  role?: string | null;
  experienceMinAnnees?: number | null;
  skillsRequired?: string[];
  skillsPreferred?: string[];
  disponibilite?: string | null;
  localisation?: string | null;
  domaine?: string | null;
  contraintes?: string[];
}): RequirementStructure {
  const skills: CritereRequirement[] = [
    ...competencesValides(input.skillsRequired).map((valeur) => ({ valeur, priorite: "REQUIRED" as const })),
    ...competencesValides(input.skillsPreferred).map((valeur) => ({ valeur, priorite: "PREFERRED" as const })),
  ];

  const champsInconnus: string[] = [];
  if (!input.role) champsInconnus.push("role");
  if (input.experienceMinAnnees == null) champsInconnus.push("experienceMinAnnees");
  if (!input.disponibilite) champsInconnus.push("disponibilite");
  if (!input.localisation) champsInconnus.push("localisation");
  if (!input.domaine) champsInconnus.push("domaine");
  if (skills.length === 0) champsInconnus.push("skills");

  return {
    role: input.role ?? null,
    experienceMinAnnees: input.experienceMinAnnees ?? null,
    skills,
    certifications: [],
    disponibilite: input.disponibilite ?? null,
    localisation: input.localisation ?? null,
    domaine: input.domaine ?? null,
    contraintes: (input.contraintes ?? []).filter((c) => c.trim() !== ""),
    champsInconnus,
    provider: "guided",
    confiance: 1,
  };
}
