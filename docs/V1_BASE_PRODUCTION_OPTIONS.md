# Base de Production V1 : récupérer l'historique ou créer une base dédiée

Ce document sert à préparer la décision ; il n'en prend aucune. Aucune action décrite ici n'a été exécutée : pas de migration, aucun changement Supabase ou Vercel, pas de déploiement.

## Faits établis
| Fait | Source |
|---|---|
| Production sert `main` (`f51573e`) et n'a pas `/api/sante` (404, lecture seule, 20/10). | GitHub Actions, `preview-lecture-seule` |
| Le dernier déploiement Production réussi date du 09/09 (`dbaed4e`). Le runtime échoue avec `tenant/user postgres.<ref historique> not found` : le projet Supabase historique est suspendu. | `docs/V1_DELIVERY_STATUS.md` |
| La base historique comporte une migration en échec (P3009 sur `20260910000000_rapport_agent_reconciliation`), probablement à cause d'objets B18 déjà présents. | `docs/V1_DELIVERY_STATUS.md`, `scripts/diagnostic-migrations.sql` |
| Les 45 migrations s'appliquent sans erreur sur une base vierge, à chaque run de CI (1 533 tests). | CI `build-and-test` |
| La Preview utilise `supabase-atlas-preview`, distincte de l'empreinte historique (`2f97519aeaf98180`). | `/api/sante` (Preview E2E 16/16, 25/10) |
| Vercel a deux variables `DATABASE_URL` distinctes, l'une pour Production, l'autre pour Preview. Leurs valeurs ne sont pas relisibles. | `docs/V1_DELIVERY_STATUS.md` |

## Ce qui n'est pas connu (à vérifier avant de décider)
1. Le projet historique est-il encore **restaurable** dans Supabase (délai de restauration d'un projet suspendu) ? À vérifier dans le tableau de bord Supabase, en lecture seule.
2. Contient-il des **données réelles à conserver** : vrais clients, ingénieurs, CV, factures ? Ou seulement des données de démonstration ?
3. Les fichiers (CV, documents) référencés par cette base sont-ils encore dans le Blob store Vercel de Production ?

## Comparaison
| Critère | A — Récupérer la base historique | B — Nouvelle base de Production dédiée |
|---|---|---|
| Données existantes | Conservées, si le projet est restaurable | Perdues, sauf import ciblé depuis une sauvegarde de A |
| Schéma | État incohérent connu (P3009, objets B18) : diagnostic puis `prisma migrate resolve` justifié | Les 45 migrations sont appliquées telles que testées en CI |
| Risque technique | Moyen à élevé : état réel inconnu, résolution manuelle d'une migration | Faible : procédure identique à la CI, reproductible |
| Réversibilité | Sauvegarde `pg_dump` + test de restauration **avant** toute écriture | Base neuve, aucune donnée existante touchée ; retour possible vers A tant qu'A n'est pas supprimée |
| Isolation par rapport à la Preview | À prouver par `/api/sante` après déploiement (empreinte historique ≠ `atlas-preview`) | Idem ; nouvelle empreinte, à enregistrer dans `lib/db-target.ts` |
| Comptes | Comptes existants ; leurs mots de passe restent inconnus | Un compte Admin à créer de façon contrôlée ; **aucun** compte de démo en Production |
| RGPD | Données personnelles anciennes à justifier (finalité, durée de conservation) | Pas de stock de données à justifier au départ |
| Délai | Dépend de la restauration Supabase et du diagnostic | Création du projet, application des migrations, configuration de Vercel |

## Recommandation (à valider)
**B comme base cible, avec A en lecture seule pour une sauvegarde si elle est restaurable.**
- Si l'étape 2 montre qu'A ne contient que des données de démonstration, B suffit.
- Si A contient des données réelles, on importe seulement ce qui est nécessaire dans B, après une sauvegarde complète d'A et une décision sur chaque catégorie de données.

## Étapes irréversibles ou sensibles (chacune exige une autorisation explicite)
1. Restaurer ou réactiver le projet Supabase historique.
2. Créer le projet Supabase de Production.
3. Appliquer les migrations (`npm run migrate:deploy`) sur la base choisie.
4. Modifier `DATABASE_URL` (Production) dans Vercel.
5. Fusionner dans `main` et déployer en Production ; puis lire `/api/sante` sur la Production pour prouver l'isolation.
6. Créer le premier compte Admin de Production.
7. Supprimer, un jour, le projet historique.
