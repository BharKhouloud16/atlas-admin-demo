// Matching Engine — ATLAS TALENT V1 (fondations). Moteur de scoring
// déterministe (pas d'appel IA ici, contrairement à l'AI Request Analyzer :
// voir lib/talent/analyseur.ts) qui compare une DemandeTalent déjà analysée
// à l'ensemble des Profil existants, en réutilisant les mêmes signaux que
// lib/scoring.ts (séniorité, disponibilité) plutôt que d'en inventer de
// nouveaux. Conçu pour être appelé par un futur "Talent Agent" IA sans
// changer sa forme : le Talent Agent orchestrerait analyserDemande() +
// classerProfils() + une mise en forme, mais ce fichier reste indépendant de
// tout provider IA — un score reste vérifiable/rejouable.
//
// Chaque résultat porte une "evidence" explicite (motifs[]) : jamais une
// boîte noire, conformément à la règle human-in-the-loop — un Admin doit
// pouvoir comprendre POURQUOI un profil sort en tête avant de le valider en
// shortlist (voir ShortlistEntree.motifs, StatutShortlist).

export type ProfilPourMatching = {
  id: string;
  competences: string[];
  seniorite: string | null;
  disponibilite: string | null;
  cvValide: boolean;
  tjmEstime: number | null;
};

export type CriteresDemande = {
  competencesRecherchees: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
};

export type MotifScore = { critere: string; poids: number; detail: string };

export type ResultatMatching = {
  profilId: string;
  score: number; // 0-100
  confiance: number; // 0-1 — dépend de la complétude de la demande ET du profil, pas de l'IA
  motifs: MotifScore[];
};

const RANG_SENIORITE: Record<string, number> = { Junior: 1, Confirmé: 2, Senior: 3, Expert: 4 };

// Pondération : compétences 50% (le critère le plus discriminant pour une
// demande de talent), séniorité 25%, disponibilité 15%, budget 10%.
const POIDS = { competences: 0.5, seniorite: 0.25, disponibilite: 0.15, budget: 0.1 } as const;

function scoreCompetences(recherchees: string[], possedees: string[]): { points: number; detail: string } {
  if (recherchees.length === 0) return { points: 50, detail: "Aucune compétence spécifiée dans la demande" };
  const communes = recherchees.filter((c) => possedees.includes(c));
  const points = (communes.length / recherchees.length) * 100;
  const detail =
    communes.length > 0
      ? `${communes.length}/${recherchees.length} compétence(s) recherchée(s) : ${communes.join(", ")}`
      : "Aucune compétence recherchée trouvée sur ce profil";
  return { points, detail };
}

function scoreSeniorite(souhaitee: string | null, reelle: string | null): { points: number; detail: string } {
  if (!souhaitee) return { points: 70, detail: "Aucune séniorité exigée par la demande" };
  if (!reelle) return { points: 30, detail: "Séniorité du profil non renseignée" };
  const ecart = Math.abs((RANG_SENIORITE[reelle] ?? 2) - (RANG_SENIORITE[souhaitee] ?? 2));
  // écart 0 = parfait ; chaque niveau d'écart coûte 30 points (jamais négatif)
  const points = Math.max(0, 100 - ecart * 30);
  return { points, detail: `Souhaitée : ${souhaitee}, profil : ${reelle}` };
}

function scoreDisponibilite(disponibilite: string | null): { points: number; detail: string } {
  if (disponibilite === "Disponible immédiatement") return { points: 100, detail: disponibilite };
  if (disponibilite === "En mission actuellement chez Atlas") return { points: 65, detail: disponibilite };
  if (disponibilite === "En mission actuellement chez un autre client") return { points: 50, detail: disponibilite };
  if (disponibilite === "Non disponible immédiatement") return { points: 30, detail: disponibilite };
  return { points: 40, detail: "Non renseignée" };
}

function scoreBudget(budgetMax: number | null, tjmEstime: number | null): { points: number; detail: string } {
  if (budgetMax == null) return { points: 70, detail: "Aucun budget maximum précisé par le client" };
  if (tjmEstime == null) return { points: 50, detail: "TJM estimé du profil non renseigné" };
  if (tjmEstime <= budgetMax) return { points: 100, detail: `TJM estimé ${tjmEstime} ≤ budget max ${budgetMax}` };
  const depassementPct = (tjmEstime - budgetMax) / budgetMax;
  // au-delà de +50% de dépassement, score nul
  const points = Math.max(0, 100 - depassementPct * 200);
  return { points, detail: `TJM estimé ${tjmEstime} > budget max ${budgetMax}` };
}

export function scorerProfil(profil: ProfilPourMatching, criteres: CriteresDemande): ResultatMatching {
  const c = scoreCompetences(criteres.competencesRecherchees, profil.competences);
  const s = scoreSeniorite(criteres.senioriteSouhaitee, profil.seniorite);
  const d = scoreDisponibilite(profil.disponibilite);
  const b = scoreBudget(criteres.budgetTjmMax, profil.tjmEstime);

  const score = Math.round(
    c.points * POIDS.competences + s.points * POIDS.seniorite + d.points * POIDS.disponibilite + b.points * POIDS.budget
  );

  const motifs: MotifScore[] = [
    { critere: "Compétences", poids: POIDS.competences, detail: c.detail },
    { critere: "Séniorité", poids: POIDS.seniorite, detail: s.detail },
    { critere: "Disponibilité", poids: POIDS.disponibilite, detail: d.detail },
    { critere: "Budget", poids: POIDS.budget, detail: b.detail },
  ];

  // Confiance = complétude des données disponibles pour calculer ce score,
  // pas une note de qualité du profil : une demande sans aucun critère ou un
  // profil au dossier incomplet donnent un score peu fiable, quel qu'il soit.
  const donneesDisponibles = [
    criteres.competencesRecherchees.length > 0,
    criteres.senioriteSouhaitee != null,
    profil.seniorite != null,
    profil.disponibilite != null,
    profil.cvValide,
  ];
  const confiance = donneesDisponibles.filter(Boolean).length / donneesDisponibles.length;

  return { profilId: profil.id, score, confiance: Math.round(confiance * 100) / 100, motifs };
}

// Classe tous les profils fournis par score décroissant. Ne filtre rien lui
// même (pas de seuil arbitraire) : c'est à l'appelant (route API / Admin) de
// décider combien de résultats retenir en shortlist.
export function classerProfils(profils: ProfilPourMatching[], criteres: CriteresDemande): ResultatMatching[] {
  return profils.map((p) => scorerProfil(p, criteres)).sort((a, b) => b.score - a.score);
}
