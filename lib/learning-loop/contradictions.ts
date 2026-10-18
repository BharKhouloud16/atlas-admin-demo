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
// ANTI_PATTERN) — jamais une similarité sémantique/IA, jamais un
// embedding, jamais un appel réseau.
//
// A35.7-FIX (contrat A35 F5) : "même Client" seul ne fonde plus un
// contexte comparable — un Client peut porter des Missions de nature
// complètement différente (même axe Capability que F4, recurrence.ts),
// et deux Learnings qui n'en parlent pas n'ont aucune raison de se
// contredire au seul motif d'un chevauchement lexical fortuit sur le
// titre. Seule l'intersection "même Client ET au moins une Capability
// ACTIVE partagée avec la Mission courante" (MissionCapabilityLink,
// A21 — jamais une notion nouvelle, jamais un "Domain" inventé) est
// traitée comme un contexte où la contradiction a un sens. Hors de
// cette intersection — même Client mais Capability différente,
// Capability partagée mais Client différent, ou aucun des deux — le
// signal reste PRUDENT par construction : AUCUNE contradiction
// automatique n'est levée.
//
// LIMITATION HEURISTIQUE (documentée, non corrigée ici — contrat A35 F5
// interdit tout moteur sémantique) : (1) si la Mission courante ne
// porte elle-même AUCUNE Capability ACTIVE, le contexte n'est
// structurellement pas déterminable -> aucune contradiction n'est
// jamais levée pour ce candidat (choix délibérément prudent, jamais
// permissif par défaut) ; (2) le recoupement lexical opère sur les mots
// significatifs du `titre` uniquement (jamais le `statement`, jamais une
// paraphrase) — deux Learnings qui se contredisent réellement mais sont
// formulés avec un vocabulaire différent (synonymes, reformulation
// complète) peuvent ne produire AUCUN signal (faux négatif accepté : un
// signal manqué reste moins dangereux qu'un signal halluciné par un
// raisonnement sémantique caché) ; symétriquement, un recoupement lexical
// fortuit sur des mots génériques du même champ métier peut produire un
// signal sans contradiction réelle (faux positif accepté : il reste
// strictement un SIGNAL best-effort, jamais une vérité, conservé sans
// arbitrage automatique — contrat A34 §12).

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

export async function detecterContradictions(missionId: string, clientId: string, type: LearningType, titre: string): Promise<ContradictionDetectee[]> {
  const typeOppose = PAIRES_OPPOSEES[type];
  if (!typeOppose) return [];

  // A35.7-FIX (F5) : Capability ACTIVE de la Mission courante — même
  // source que F4 (MissionCapabilityLink, A21), jamais une nouvelle
  // notion. Aucune Capability -> contexte non déterminable -> prudent,
  // jamais permissif (voir LIMITATION ci-dessus).
  const liensCapability = await prisma.missionCapabilityLink.findMany({
    where: { missionId, statut: "ACTIVE" },
    select: { capability: true },
  });
  const capabilites = [...new Set(liensCapability.map((l) => l.capability))];
  if (capabilites.length === 0) return [];

  const candidatsOpposes = await prisma.learning.findMany({
    where: {
      type: typeOppose,
      mission: { clientId, capabilityLinks: { some: { statut: "ACTIVE", capability: { in: capabilites } } } },
    },
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
