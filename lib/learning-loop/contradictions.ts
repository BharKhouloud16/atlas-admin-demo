import type { LearningType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Détection de CONTRADICTION DÉTERMINISTE (contrat A34 §12) — jamais une
// suppression/remplacement/auto-supersession : une contradiction trouvée
// est uniquement AJOUTÉE à la justification/trace du candidat, qui reste
// proposable. L'Admin décide ensuite (contrat A34 §12, dernier
// paragraphe). Opérateur simple et explicable : recoupement de mots
// significatifs du titre entre deux types opposés (BEST_PRACTICE vs
// ANTI_PATTERN) sur le même Client — jamais une similarité sémantique/IA.

const PAIRES_OPPOSEES: Record<string, LearningType> = {
  BEST_PRACTICE: "ANTI_PATTERN",
  ANTI_PATTERN: "BEST_PRACTICE",
};

const MOTS_VIDES = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "ou", "sur", "pour", "avec", "dans", "au", "aux"]);

function motsSignificatifs(texte: string): Set<string> {
  const normalise = texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return new Set(normalise.split(/[^a-z0-9]+/).filter((m) => m.length >= 3 && !MOTS_VIDES.has(m)));
}

function recoupementSuffisant(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const plusPetit = a.size <= b.size ? a : b;
  const plusGrand = a.size <= b.size ? b : a;
  let communs = 0;
  for (const mot of plusPetit) if (plusGrand.has(mot)) communs += 1;
  return communs / plusPetit.size >= 0.5;
}

export type ContradictionDetectee = { learningId: string; type: LearningType; titre: string };

export async function detecterContradictions(clientId: string, type: LearningType, titre: string): Promise<ContradictionDetectee[]> {
  const typeOppose = PAIRES_OPPOSEES[type];
  if (!typeOppose) return [];

  const candidatsOpposes = await prisma.learning.findMany({
    where: { type: typeOppose, mission: { clientId } },
    select: { id: true, title: true, type: true },
  });

  const motsCandidat = motsSignificatifs(titre);
  const contradictions: ContradictionDetectee[] = [];
  for (const c of candidatsOpposes) {
    if (recoupementSuffisant(motsCandidat, motsSignificatifs(c.title))) {
      contradictions.push({ learningId: c.id, type: c.type, titre: c.title });
    }
  }
  return contradictions;
}
