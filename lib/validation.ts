import { z } from "zod";

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
