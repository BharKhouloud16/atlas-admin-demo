# Migrations des lots 2 à 6 et des corrections de revue — application et retour arrière

Toutes les migrations sont **additives** : nouvelles tables, nouveaux types et colonnes facultatives (NULL). Aucune table, colonne ou donnée existante n'est modifiée ou supprimée.

| Ordre | Migration | Contenu |
|---|---|---|
| 1 | `20261028100000_lot2_suivi_profils_proposes` | Types `ActionTalentClientType`, `ActionTalentClientStatut` ; tables `ActionTalentClient`, `SolutionOptionProfilInterne` |
| 2 | `20261028110000_lot3_profil_entreprise` | 7 colonnes facultatives sur `Client` |
| 3 | `20261028120000_lot5_activation_atlas_os` | Type `StatutAtlasOs` ; table `ActivationAtlasOs` |
| 4 | `20261028130000_lot6_projets` | 4 types ; tables `Projet`, `PropositionProjet`, `EvenementProjet` ; colonne facultative `Mission.projetId` (ON DELETE SET NULL) |
| 5 | `20261101100000_rev_corrections` | Type `StatutDemandeClient` ; table `SolutionVague` (recherches de profils mémorisées) ; 3 colonnes facultatives sur `EvenementProjet` (suivi des demandes Client) |

## Application (sur autorisation uniquement)

1. Sauvegarde de la base cible.
2. `npx prisma migrate deploy` avec l'URL de la base cible (jamais la Production sans autorisation explicite).
3. Déployer ensuite le code correspondant. L'ancien code (`a9768fc`) reste compatible avec le schéma migré, car il ignore les nouvelles tables et colonnes. On peut donc migrer avant de déployer.

## Retour arrière

- **Cas simple : retour arrière du code seul.** Redéployer `a9768fc`. Le schéma migré est compatible et aucune donnée n'est perdue. C'est la voie recommandée.
- **Retour arrière complet du schéma** : il est **destructif**, car il efface les données créées par les lots 2 à 6. Il ne s'exécute que sur décision explicite et après sauvegarde :
  `psql "$URL" -v ON_ERROR_STOP=1 -f docs/lots-2026-10/retour_arriere_lots_2_6.sql`
  Le script s'exécute en une seule transaction (tout ou rien) et retire aussi les 5 lignes de `_prisma_migrations`.

## Vérification effectuée (environnement isolé, 28/10 puis 01/11/2026)

- Les 52 migrations (47 de `a9768fc` + 5 ajoutées) s'appliquent sur une base vide (`psql -v ON_ERROR_STOP=1`), puis le seed s'exécute.
- Sur une copie PEUPLÉE (projets, propositions, missions rattachées, actions Talents, activations, 110 recherches mémorisées), le script de retour arrière réussit, les missions sont conservées et le schéma (`pg_dump -s`) redevient **identique** à celui des 47 migrations de `a9768fc`.
- Les 5 migrations se ré-appliquent ensuite sans erreur.
