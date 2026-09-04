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
