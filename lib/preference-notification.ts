import { prisma } from "@/lib/prisma";
import type { AttentionCategorie } from "@prisma/client";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 3 — Préférences,
// 21/09/2026).
//
// Individuelle via User.id (règle #12) — jamais un réglage par rôle, un
// même modèle sert Client et Admin indifféremment (voir prisma/schema.prisma,
// PreferenceNotification). Défauts mandatés : email actif par défaut,
// ACTION_REQUISE + ALERTE actives par défaut (catégories qui appellent une
// action ou signalent un risque), INFORMATION/RECOMMANDATION désactivables
// (bruit informatif, opt-in par email). Une absence de ligne en base
// EST le défaut — jamais besoin de la créer avant que l'utilisateur ne
// modifie quoi que ce soit.
export const CATEGORIES_EMAIL_PAR_DEFAUT: AttentionCategorie[] = ["ACTION_REQUISE", "ALERTE"];
const CATEGORIES_VALIDES: readonly AttentionCategorie[] = ["ACTION_REQUISE", "ALERTE", "INFORMATION", "RECOMMANDATION"];

export type PreferenceNotificationVue = { emailActif: boolean; categoriesEmail: AttentionCategorie[] };

export async function lirePreferenceNotification(userId: string): Promise<PreferenceNotificationVue> {
  const pref = await prisma.preferenceNotification.findUnique({ where: { userId } });
  if (!pref) return { emailActif: true, categoriesEmail: CATEGORIES_EMAIL_PAR_DEFAUT };
  return { emailActif: pref.emailActif, categoriesEmail: pref.categoriesEmail };
}

// Vocabulaire fermé (mandat : jamais une catégorie hors AttentionCategorie)
// — rejette tout ce qui n'est pas un tableau de valeurs connues, jamais un
// 500 sur une entrée malformée.
export function validerCategoriesEmail(valeur: unknown): AttentionCategorie[] | null {
  if (!Array.isArray(valeur)) return null;
  if (!valeur.every((v) => typeof v === "string" && (CATEGORIES_VALIDES as string[]).includes(v))) return null;
  return Array.from(new Set(valeur)) as AttentionCategorie[];
}

export async function ecrirePreferenceNotification(
  userId: string,
  donnees: { emailActif?: boolean; categoriesEmail?: AttentionCategorie[] }
): Promise<PreferenceNotificationVue> {
  const actuelle = await lirePreferenceNotification(userId);
  const emailActif = donnees.emailActif ?? actuelle.emailActif;
  const categoriesEmail = donnees.categoriesEmail ?? actuelle.categoriesEmail;
  const pref = await prisma.preferenceNotification.upsert({
    where: { userId },
    update: { emailActif, categoriesEmail },
    create: { userId, emailActif, categoriesEmail },
  });
  return { emailActif: pref.emailActif, categoriesEmail: pref.categoriesEmail };
}
