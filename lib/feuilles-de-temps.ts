// Statuts du circuit de validation des feuilles de temps (CRA), façon
// BoondManager : Brouillon (édition libre côté ingénieur) -> Soumise
// (verrouillée, en attente Admin) -> ValideeAdmin (en attente Client) ->
// ValideeClient (définitive, facturable). Rejetee renvoie à l'ingénieur
// avec un motif, ré-éditable comme un Brouillon. Voir prisma/schema.prisma
// (FeuilleDeTemps) et app/api/feuilles-de-temps/route.ts.
export const STATUTS_CRA = ["Brouillon", "Soumise", "ValideeAdmin", "ValideeClient", "Rejetee"] as const;
export type StatutCra = (typeof STATUTS_CRA)[number];

export const LABEL_STATUT_CRA: Record<StatutCra, string> = {
  Brouillon: "Brouillon",
  Soumise: "Soumise — en attente Admin",
  ValideeAdmin: "Validée Admin — en attente Client",
  ValideeClient: "Validée Client",
  Rejetee: "Rejetée",
};

export const COULEUR_STATUT_CRA: Record<StatutCra, string> = {
  Brouillon: "#9aa0ab",
  Soumise: "#d97706",
  ValideeAdmin: "#2563eb",
  ValideeClient: "#16a34a",
  Rejetee: "#dc2626",
};

// L'ingénieur peut éditer/soumettre tant que le CRA n'est pas engagé dans le
// circuit de validation (ou après un rejet, qui le renvoie en édition).
export function craEstEditableParIngenieur(statut: string): boolean {
  return statut === "Brouillon" || statut === "Rejetee";
}

// Mois au format "AAAA-MM", utilisé comme clé unique par mission (voir
// @@unique([missionId, mois]) sur FeuilleDeTemps).
export function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function libelleMois(mois: string): string {
  const [annee, m] = mois.split("-").map(Number);
  if (!annee || !m) return mois;
  return new Date(annee, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// Détail jour par jour du calendrier CRA façon Boond (voir
// components/CalendrierCra.tsx, colonne FeuilleDeTemps.detailJours) — type
// et calcul des totaux mis ici plutôt que dans le composant (qui est "use
// client") pour pouvoir être réutilisés côté serveur par
// app/api/feuilles-de-temps/route.ts, qui recalcule les totaux à partir du
// détail envoyé plutôt que de faire confiance aux nombres agrégés du client.
export type JourCra = { date: string; travaille: boolean; heures: number; commentaire?: string };

export function totauxDepuisDetail(detail: JourCra[]): { joursTravailles: number; heuresSupplementaires: number } {
  let heuresNormales = 0;
  let heuresSup = 0;
  for (const j of detail) {
    if (!j.travaille) continue;
    const h = j.heures || 0;
    heuresNormales += Math.min(h, 8);
    heuresSup += Math.max(h - 8, 0);
  }
  return {
    joursTravailles: Math.round((heuresNormales / 8) * 2) / 2,
    heuresSupplementaires: Math.round(heuresSup * 2) / 2,
  };
}

// Nombre de jours du mois "AAAA-MM" (28 à 31), ou null si le mois est invalide.
export function joursDansMois(mois: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  if (!m) return null;
  const annee = Number(m[1]);
  const numero = Number(m[2]);
  if (numero < 1 || numero > 12) return null;
  return new Date(Date.UTC(annee, numero, 0)).getUTCDate();
}

// Contrôle serveur d'une saisie de CRA, avant tout calcul de totaux : un
// détail jour par jour doit porter sur des dates réelles du mois déclaré,
// chacune une seule fois, avec 0 à 24 heures ; des totaux saisis sans
// détail doivent rester dans les bornes du mois. Renvoie le message
// d'erreur à afficher, ou null si la saisie est cohérente.
export function erreurSaisieCra(
  mois: string,
  saisie: { detailJours?: unknown; joursTravailles?: unknown; heuresSupplementaires?: unknown }
): string | null {
  const nbJours = joursDansMois(mois);
  if (nbJours === null) return "Mois (AAAA-MM) invalide.";

  if (saisie.detailJours !== undefined && saisie.detailJours !== null) {
    if (!Array.isArray(saisie.detailJours)) return "Détail des jours invalide.";
    const vus = new Set<string>();
    for (const j of saisie.detailJours as Partial<JourCra>[]) {
      const date = typeof j?.date === "string" ? j.date : "";
      const numeroJour = date.startsWith(`${mois}-`) ? Number(date.slice(8)) : NaN;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(numeroJour >= 1 && numeroJour <= nbJours)) {
        return `Le jour « ${date || "?"} » n'appartient pas au mois déclaré.`;
      }
      if (vus.has(date)) return `Le jour ${date} est saisi plusieurs fois.`;
      vus.add(date);
      if (typeof j.travaille !== "boolean") return `Jour ${date} : statut travaillé invalide.`;
      const heures = j.heures ?? 0;
      if (typeof heures !== "number" || !Number.isFinite(heures) || heures < 0 || heures > 24) {
        return `Jour ${date} : le nombre d'heures doit être compris entre 0 et 24.`;
      }
    }
    return null;
  }

  const jours = Number(saisie.joursTravailles);
  if (!Number.isFinite(jours) || jours < 0 || jours > nbJours) {
    return `Nombre de jours travaillés invalide (0 à ${nbJours} pour ce mois).`;
  }
  const heuresSup = saisie.heuresSupplementaires === undefined || saisie.heuresSupplementaires === null || saisie.heuresSupplementaires === "" ? 0 : Number(saisie.heuresSupplementaires);
  if (!Number.isFinite(heuresSup) || heuresSup < 0 || heuresSup > nbJours * 16) {
    return "Nombre d'heures supplémentaires invalide.";
  }
  return null;
}

// Mission close (Mission.statut, texte libre : "En cours" / "Terminée" /
// "Annulée") : plus aucune saisie ordinaire de CRA par l'Ingénieur. Une
// correction reste possible par l'Admin, motivée et tracée (voir
// app/api/feuilles-de-temps/correction/route.ts).
export const STATUTS_MISSION_CLOSE = ["Terminée", "Annulée"];

export function missionEstClose(statut: string): boolean {
  return STATUTS_MISSION_CLOSE.includes(statut);
}
