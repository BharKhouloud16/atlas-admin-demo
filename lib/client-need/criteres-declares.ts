import type { ClientNeedFaitCle } from "@prisma/client";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { PAYS } from "@/lib/localisation";

// LOT 7 (01/11/2026) — assistant « Exprimer un besoin » (planche) : critères
// DÉCLARÉS par le Client dans le formulaire, validés côté serveur (listes
// fermées, bornes) puis enregistrés comme faits DECLARE (source
// « client_formulaire »). Le texte libre reste analysé par ATLAS comme avant ;
// une valeur déclarée ici l'emporte sur la valeur déduite du texte.
// Module PUR (aucun accès base) : utilisable par l'interface et par l'API.

export const TYPES_MISSION = ["Renfort d'équipe", "Expertise ponctuelle", "Audit ou conseil", "Autre"] as const;
export const DUREES = ["Moins de 3 mois", "3 à 6 mois", "6 à 12 mois", "Plus de 12 mois", "Non définie"] as const;
export const SENIORITES = ["Junior", "Confirmé", "Senior", "Expert"] as const;
export const MODES_TRAVAIL = ["Sur site", "Hybride", "Remote possible"] as const;

export type CriteresDeclares = {
  typeMission?: string;
  duree?: string;
  localisation?: string;
  competences?: string[];
  seniorite?: string;
  quantite?: number;
  budgetTjm?: number;
  dateDebut?: string; // AAAA-MM
  modeTravail?: string;
};

export type FaitDeclare = { cle: ClientNeedFaitCle; valeur: string; source: string };

const SOURCE = "client_formulaire";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function validerCriteresDeclares(brut: unknown): { ok: true; faits: FaitDeclare[] } | { ok: false; erreur: string } {
  if (brut === undefined || brut === null) return { ok: true, faits: [] };
  if (typeof brut !== "object" || Array.isArray(brut)) return { ok: false, erreur: "criteres invalides." };
  const c = brut as Record<string, unknown>;
  const faits: FaitDeclare[] = [];
  const dansListe = (v: unknown, liste: readonly string[], nom: string): string | null | Error => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !liste.includes(v)) return new Error(`${nom} invalide.`);
    return v;
  };

  const typeMission = dansListe(c.typeMission, TYPES_MISSION, "Type de mission");
  if (typeMission instanceof Error) return { ok: false, erreur: typeMission.message };
  if (typeMission) faits.push({ cle: "CONTEXTE", valeur: `Type de mission : ${typeMission}`, source: SOURCE });

  const duree = dansListe(c.duree, DUREES, "Durée estimée");
  if (duree instanceof Error) return { ok: false, erreur: duree.message };
  if (duree && duree !== "Non définie") faits.push({ cle: "DUREE", valeur: duree, source: SOURCE });

  const localisation = dansListe(c.localisation, PAYS as readonly string[], "Localisation");
  if (localisation instanceof Error) return { ok: false, erreur: localisation.message };
  if (localisation) faits.push({ cle: "LOCALISATION", valeur: localisation, source: SOURCE });

  if (c.competences !== undefined) {
    if (!Array.isArray(c.competences) || c.competences.length > 20 || c.competences.some((x) => typeof x !== "string" || !TOUTES_COMPETENCES.includes(x))) {
      return { ok: false, erreur: "Compétences : choisissez-les dans la liste proposée (20 au plus)." };
    }
    for (const competence of new Set(c.competences as string[])) faits.push({ cle: "COMPETENCE", valeur: competence, source: SOURCE });
  }

  const seniorite = dansListe(c.seniorite, SENIORITES, "Séniorité");
  if (seniorite instanceof Error) return { ok: false, erreur: seniorite.message };
  if (seniorite) faits.push({ cle: "SENIORITE", valeur: seniorite, source: SOURCE });

  if (c.quantite !== undefined && c.quantite !== null && c.quantite !== "") {
    if (typeof c.quantite !== "number" || !Number.isInteger(c.quantite) || c.quantite < 1 || c.quantite > 50) return { ok: false, erreur: "Nombre de profils : entier de 1 à 50." };
    faits.push({ cle: "QUANTITE", valeur: String(c.quantite), source: SOURCE });
  }

  if (c.budgetTjm !== undefined && c.budgetTjm !== null && c.budgetTjm !== "") {
    if (typeof c.budgetTjm !== "number" || !Number.isFinite(c.budgetTjm) || c.budgetTjm <= 0 || c.budgetTjm > 100000) return { ok: false, erreur: "Budget journalier : montant positif en euros." };
    faits.push({ cle: "BUDGET_MONTANT", valeur: String(Math.round(c.budgetTjm)), source: SOURCE });
    faits.push({ cle: "BUDGET_DEVISE", valeur: "EUR", source: SOURCE });
    faits.push({ cle: "BUDGET_TYPE", valeur: "TJM", source: SOURCE });
  }

  if (c.dateDebut !== undefined && c.dateDebut !== null && c.dateDebut !== "") {
    const m = typeof c.dateDebut === "string" ? /^(\d{4})-(\d{2})$/.exec(c.dateDebut) : null;
    const mois = m ? Number(m[2]) : 0;
    if (!m || mois < 1 || mois > 12) return { ok: false, erreur: "Date de début : mois et année (AAAA-MM)." };
    faits.push({ cle: "DATE_DEBUT", valeur: `${MOIS[mois - 1]} ${m[1]}`, source: SOURCE });
  }

  const modeTravail = dansListe(c.modeTravail, MODES_TRAVAIL, "Mode de travail");
  if (modeTravail instanceof Error) return { ok: false, erreur: modeTravail.message };
  if (modeTravail) faits.push({ cle: "REMOTE", valeur: modeTravail, source: SOURCE });

  return { ok: true, faits };
}
