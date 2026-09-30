import { z } from "zod";
import { TOUTES_COMPETENCES } from "@/lib/competences";

// Schémas de validation d'entrée (zod) pour les routes d'authentification —
// remplace les vérifications manuelles au coup par coup par des schémas
// déclaratifs, plus sûrs et plus faciles à faire évoluer. Volontairement
// démarré sur le périmètre le plus sensible (auth) ; à étendre aux autres
// routes API au fil de l'eau plutôt que réécrit d'un coup partout.

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse email invalide."),
  password: z.string().min(1, "Mot de passe requis."),
});

export const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Adresse email invalide."),
    password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
    role: z.enum(["INGENIEUR", "CLIENT"], { errorMap: () => ({ message: "Rôle invalide." }) }),
    nom: z.string().trim().min(1, "Le nom est requis.").max(200),
    prenom: z.string().trim().max(200).optional(),
    consentementRgpd: z.literal(true, {
      errorMap: () => ({ message: "Merci d'accepter le traitement de vos données (RGPD)." }),
    }),
    telephone: z.string().trim().max(50).optional(),
    contactReferent: z.string().trim().max(200).optional(),
    identifiantEntreprise: z.string().trim().max(100).optional(),
    formeJuridique: z.string().trim().max(100).optional(),
    secteur: z.string().trim().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "INGENIEUR" && !data.prenom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le prénom est requis.", path: ["prenom"] });
    }
    if (data.role === "CLIENT" && !data.telephone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le numéro de téléphone est requis.", path: ["telephone"] });
    }
  });

export const motDePasseSchema = z
  .object({
    ancienMotDePasse: z.string().min(1, "Ancien mot de passe requis."),
    nouveauMotDePasse: z.string().min(8, "Le nouveau mot de passe doit contenir au moins 8 caractères."),
    confirmationNouveauMotDePasse: z.string().min(1),
  })
  .refine((data) => data.nouveauMotDePasse === data.confirmationNouveauMotDePasse, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmationNouveauMotDePasse"],
  });

export const demanderReinitialisationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse email invalide."),
});

export const reinitialiserMotDePasseSchema = z
  .object({
    token: z.string().min(1, "Lien de réinitialisation invalide."),
    nouveauMotDePasse: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
    confirmationNouveauMotDePasse: z.string().min(1),
  })
  .refine((data) => data.nouveauMotDePasse === data.confirmationNouveauMotDePasse, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmationNouveauMotDePasse"],
  });

// Aide pour renvoyer le premier message d'erreur zod sous la même forme que
// les erreurs existantes ({ error: string }), pour ne rien changer côté
// front (les composants attendent déjà data.error).
export function premierMessageZod(erreur: z.ZodError): string {
  return erreur.issues[0]?.message ?? "Données invalides.";
}

// ATLAS TALENT V1 — création d'une DemandeTalent par un Client (voir
// app/api/talent/demandes/route.ts). La description est le texte libre
// donné à l'AI Request Analyzer (lib/talent/analyseur.ts) : bornée en
// longueur comme toute entrée utilisateur, jamais interprétée côté serveur
// autrement que comme du texte à analyser (aucune exécution de code, aucune
// injection de prompt possible côté DB/SQL — Prisma paramètre toujours ses
// requêtes).
export const demandeTalentSchema = z.object({
  titre: z.string().trim().max(200).optional(),
  description: z.string().trim().min(10, "Merci de décrire votre besoin (10 caractères minimum).").max(4000),
  budgetTjmMax: z.number().positive().max(100000).optional(),
  budgetDevise: z.string().trim().toUpperCase().length(3).optional(),
  dateDebutSouhaitee: z.string().datetime().optional(),
});

// "Critères de matching" d'une DemandeTalent — révision par l'Admin avant
// de lancer le Matching Engine (voir PATCH /api/talent/demandes/[id]).
// Réservé à l'Admin (jamais au Client, voir la route) ; tous les champs
// sont optionnels pour permettre une mise à jour partielle, mais chaque
// valeur fournie reste strictement bornée comme toute entrée utilisateur.
export const criteresTalentSchema = z.object({
  competencesExtraites: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  senioriteSouhaitee: z.string().trim().max(50).nullable().optional(),
  anneesExperienceMin: z.number().int().min(0).max(60).nullable().optional(),
  secteurActivite: z.string().trim().max(200).nullable().optional(),
  localisation: z.string().trim().max(200).nullable().optional(),
  mobilite: z.string().trim().max(100).nullable().optional(),
  disponibiliteSouhaitee: z.string().trim().max(100).nullable().optional(),
  budgetTjmMax: z.number().positive().max(100000).nullable().optional(),
  budgetDevise: z.string().trim().toUpperCase().length(3).optional(),
});

// LOT 5 — Client Intelligence → Talent Bridge (15/09/2026) : composition des
// deux schémas ci-dessus (jamais une redéfinition des mêmes bornes) pour
// POST /api/talent/besoins/[id]/creer-demande — l'Admin y soumet les MÊMES
// champs qu'une création directe (demandeTalentSchema) et qu'une révision
// de critères (criteresTalentSchema), jamais un troisième vocabulaire.
export const demandeDepuisBesoinSchema = demandeTalentSchema.merge(criteresTalentSchema);

// LOT 15.5 — Client Requirement Builder. "analyserBesoinSchema" : entrée du
// mode Expression libre (POST .../besoin/analyser) — mêmes bornes que
// demandeTalentSchema.description, jamais un texte non borné envoyé à l'IA.
export const analyserBesoinSchema = z.object({
  description: z.string().trim().min(10, "Merci de décrire votre besoin (10 caractères minimum).").max(4000),
});

const critereRequirementSchema = z.object({
  valeur: z.string().trim().min(1).max(80),
  priorite: z.enum(["REQUIRED", "PREFERRED", "OPTIONAL"]),
});

// "requirementStructureSchema" : forme validée avant persistance dans
// DemandeTalent.criteresStructures (PATCH .../besoin) — que le Client l'ait
// obtenue via l'IA (puis corrigée) ou construite en mode Critères guidés,
// c'est exactement la même forme qui est vérifiée et stockée ici (Partie C
// du mandat : un seul concept métier, quel que soit le mode d'entrée).
//
// LOT 15.5.2 — HARDENING : point de validation UNIQUE et centralisé pour
// l'invariant "toute compétence persistée appartient à TOUTES_COMPETENCES".
// Nécessaire ici précisément parce que c'est le seul des trois chemins de
// construction d'un RequirementStructure (analyserLocalement,
// parserReponseAnthropic, construireRequirementDepuisCriteresGuides — voir
// lib/talent/requirement-analyzer.ts) qui n'applique PAS déjà ce filtre : les
// trois autres construisent leur résultat à partir de TOUTES_COMPETENCES et
// ne peuvent donc structurellement pas produire de valeur hors liste. Seul
// le PATCH direct { requirement: ... } accepte une structure entièrement
// fournie par l'appelant — c'est donc la seule frontière qui doit revalider.
// Rejet (400, jamais une valeur silencieusement écartée) : plus honnête pour
// un appelant qui soumet un besoin qu'il vient de relire/confirmer.
//
// "certifications" reste volontairement NON filtrée : ATLAS ne définit
// aujourd'hui aucune taxonomie fermée de certifications (voir
// lib/talent/requirement-analyzer.ts::normaliserCriteres, appelé avec
// competencesFermees=false pour les certifications) — seules les bornes de
// longueur déjà en place s'appliquent, jamais une liste inventée ici.
export const requirementStructureSchema = z
  .object({
    role: z.string().trim().max(100).nullable(),
    experienceMinAnnees: z.number().int().min(0).max(60).nullable(),
    skills: z.array(critereRequirementSchema).max(30),
    certifications: z.array(critereRequirementSchema).max(20),
    disponibilite: z.string().trim().max(100).nullable(),
    localisation: z.string().trim().max(200).nullable(),
    domaine: z.string().trim().max(200).nullable(),
    contraintes: z.array(z.string().trim().min(1).max(200)).max(20),
    champsInconnus: z.array(z.string()).max(20),
    provider: z.enum(["anthropic", "local", "guided"]),
    confiance: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    const competencesFermees = new Set(TOUTES_COMPETENCES);
    data.skills.forEach((s, i) => {
      if (!competencesFermees.has(s.valeur)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skills", i, "valeur"],
          message: `Compétence inconnue : "${s.valeur}" n'appartient pas à la liste des compétences ATLAS.`,
        });
      }
    });
  });

// Entrée du mode Critères guidés (Partie B, Mode 2) — construite côté
// serveur en RequirementStructure via
// lib/talent/requirement-analyzer.ts::construireRequirementDepuisCriteresGuides,
// jamais un second schéma de sortie divergent.
export const criteresGuidesSchema = z.object({
  role: z.string().trim().max(100).nullable().optional(),
  experienceMinAnnees: z.number().int().min(0).max(60).nullable().optional(),
  skillsRequired: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  skillsPreferred: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  disponibilite: z.string().trim().max(100).nullable().optional(),
  localisation: z.string().trim().max(200).nullable().optional(),
  domaine: z.string().trim().max(200).nullable().optional(),
  contraintes: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

// ATLAS SKILL GRAPH V1 — correction explicite d'une ProfilCompetence par un
// Admin (voir PATCH /api/profils/[id]/competences/[competenceId]). C'est la
// SEULE voie légitime pour fixer un niveau (1-5) ou passer une compétence en
// statut VERIFIE : jamais l'IA, jamais un recalcul automatique (voir
// lib/talent/skill-graph.ts). "detail" documente la preuve humaine (ex:
// "confirmé en entretien technique") — jamais fabriqué si l'Admin ne
// renseigne rien.
export const corrigerCompetenceSchema = z.object({
  statut: z.enum(["VERIFIE", "DECLARE", "INFERE", "INCONNU"]),
  niveau: z.number().int().min(1).max(5).nullable().optional(),
  anneesExperience: z.number().int().min(0).max(60).nullable().optional(),
  contexte: z.string().trim().max(200).nullable().optional(),
  secteur: z.string().trim().max(200).nullable().optional(),
  detail: z.string().trim().max(300).nullable().optional(),
});

// ATLAS DYNAMIC SKILL GRAPH — ajout d'une nouvelle preuve (SkillEvidence) à
// une ProfilCompetence existante, TOUJOURS additif (voir POST .../
// competences/[competenceId]/preuves) : jamais de suppression/écrasement
// d'une preuve précédente. `niveauObserve` est le niveau (1-5) vu par CETTE
// preuve précise, distinct du niveau courant (voir SkillEvidence.niveau) —
// optionnel, jamais déduit automatiquement. `statutPropose` permet à
// l'Admin de proposer une évolution de statut, qui reste soumise à
// fusionnerCompetence (jamais de régression, voir lib/talent/skill-graph.ts).
export const ajouterPreuveSchema = z.object({
  source: z.enum(["CV", "PROFIL", "CERTIFICATION", "MISSION", "EVALUATION", "ASSESSMENT", "ADMIN"]),
  detail: z.string().trim().max(300).nullable().optional(),
  niveauObserve: z.number().int().min(1).max(5).nullable().optional(),
  statutPropose: z.enum(["VERIFIE", "DECLARE", "INFERE", "INCONNU"]).optional(),
});

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL (28/09/2026). `competence` est
// volontairement un string simple ici (pas un z.enum dynamique) — la
// vérification contre le vocabulaire fermé (lib/competences.ts::
// TOUTES_COMPETENCES) reste faite par la route elle-même, exactement comme
// POST /api/ingenieur/disponibilite le fait déjà pour Profil.competences :
// jamais un deuxième mécanisme de validation du même vocabulaire.
// `niveauPropose` est une simple DÉCLARATION de l'Ingénieur (ou de l'Admin
// proposant) — jamais utilisée telle quelle comme niveau de preuve (voir
// D3, mandat Phase 2B-1) : seul `niveauObserve`, fourni par l'Admin à la
// décision (missionSkillProposalDecisionSchema ci-dessous), alimente la
// SkillEvidence créée.
export const missionSkillProposalSchema = z.object({
  competence: z.string().trim().min(1).max(100),
  niveauPropose: z.number().int().min(1).max(5).nullable().optional(),
  contexte: z.string().trim().max(300).nullable().optional(),
});

// D1 — modification d'une proposition tant qu'elle est EN_ATTENTE : mêmes
// champs, tous optionnels (une modification partielle reste valide), mais
// au moins un champ doit être fourni pour distinguer une vraie modification
// d'un appel vide.
export const missionSkillProposalModificationSchema = z
  .object({
    competence: z.string().trim().min(1).max(100).optional(),
    niveauPropose: z.number().int().min(1).max(5).nullable().optional(),
    contexte: z.string().trim().max(300).nullable().optional(),
  })
  .refine((donnees) => donnees.competence !== undefined || donnees.niveauPropose !== undefined || donnees.contexte !== undefined, {
    message: "Au moins un champ à modifier (competence, niveauPropose ou contexte) est requis.",
  });

// Décision Admin (valider/refuser) — whitelist stricte d'actions, même
// discipline que app/api/missions/[id]/transition/route.ts (Phase 2B-0) et
// app/api/factures/[id]/transition/route.ts : jamais un `statut` accepté
// tel quel depuis le body.
export const missionSkillProposalDecisionSchema = z.object({
  action: z.enum(["valider", "refuser"]),
  niveauObserve: z.number().int().min(1).max(5).nullable().optional(),
  motif: z.string().trim().max(300).nullable().optional(),
});

// EVALUATION API HARDENING — contrat métier de POST /api/evaluations
// STRICTEMENT inchangé (voir audit "Evaluation API Hardening & Test Audit") :
// `note` accepte un entier OU une chaîne numérique (comportement déjà en
// place avant ce schéma, préservé tel quel — un formulaire HTML envoie
// souvent un nombre sous forme de chaîne) mais reste borné 1..5, entier,
// jamais NaN/Infinity/décimal. Le `preprocess` ne laisse passer vers
// `z.number()` que les entrées déjà `number`/`string` — un objet, tableau,
// booléen ou `null` échoue donc le type de base, jamais une coercition
// silencieuse. `missionId`/`profilId`/`clientId` ne sont jamais dérivables
// depuis le body au-delà de `missionId` lui-même — la Mission/le Client
// réels restent systématiquement dérivés côté serveur par la route (jamais
// par ce schéma), même discipline que missionSkillProposalSchema ci-dessus.
export const evaluationSchema = z.object({
  missionId: z.string().trim().min(1, "missionId requis."),
  note: z.preprocess(
    (valeur) => (typeof valeur === "number" || typeof valeur === "string" ? Number(valeur) : valeur),
    z
      .number({ invalid_type_error: "Note invalide (1 à 5)." })
      .int("Note invalide (1 à 5).")
      .min(1, "Note invalide (1 à 5).")
      .max(5, "Note invalide (1 à 5).")
  ),
  // Vide/blanc après trim -> null (jamais une chaîne vide stockée) ; un
  // type non-string (objet, tableau, nombre) échoue le type de base avant
  // même d'atteindre trim/max, jamais coercé silencieusement. 2000 : borne
  // large mais explicite, cohérente avec le fait qu'aucune limite n'existait
  // auparavant (voir audit, Finding 3).
  commentaire: z
    .string()
    .trim()
    .max(2000, "Commentaire trop long (2000 caractères maximum).")
    .nullable()
    .optional()
    .transform((valeur) => (valeur ? valeur : null)),
});
