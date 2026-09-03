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
