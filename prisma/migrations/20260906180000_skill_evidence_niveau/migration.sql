-- ATLAS DYNAMIC SKILL GRAPH — ajoute un niveau (1-5) observé par preuve
-- individuelle, distinct du niveau courant sur ProfilCompetence. Additive et
-- rétrocompatible : colonne nullable, aucune ligne existante affectée,
-- aucune donnée supprimée. Permet de reconstituer l'historique d'évolution
-- d'un niveau dans le temps sans jamais écraser une preuve précédente (voir
-- lib/talent/skill-graph.ts, niveauxHistoriques()).
ALTER TABLE "SkillEvidence" ADD COLUMN "niveau" INTEGER;
