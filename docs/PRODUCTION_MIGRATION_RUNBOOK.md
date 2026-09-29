# Runbook — Migrations Prisma en production

Document opérationnel : que faire, dans l'ordre, pour appliquer des
migrations Prisma en production, et comment réagir si une migration
échoue. Rédigé en amont de tout déploiement réel (aucun déploiement, aucune
base de production n'existe à ce jour pour ATLAS — voir Lot 13, `BLOCKED —
VERCEL ACCESS UNAVAILABLE`) : c'est une préparation, pas un retour
d'incident réel.

Portée : uniquement les migrations Prisma (`prisma/migrations/`) et leur
application via `prisma migrate deploy`. Ne couvre pas la sauvegarde/
restauration de la base elle-même (§8 — responsabilité du fournisseur
d'hébergement, pas inventée ici), ni le choix d'un fournisseur (§9).

Sources officielles citées : `www.prisma.io` est bloqué en accès direct
depuis cet environnement (`EGRESS_BLOCKED`) — les citations ci-dessous
s'appuient sur les résultats de recherche web (résumés + citations du
contenu officiel) plutôt que sur une lecture directe des pages. À
revérifier sur les pages sources avant toute action réelle en production
(URLs listées en §14).

## 1. État actuel du projet (constaté, pas supposé)

- Prisma `^5.18.0` (`prisma` et `@prisma/client`, voir `package.json`).
- `prisma/schema.prisma` — datasource :
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  ```
  Aucun `directUrl`. Une seule variable d'environnement lue pour la
  connexion (`DATABASE_URL`).
- 46 migrations dans `prisma/migrations/`. La plus récente :
  `20260928121318_add_mission_skill_proposal`.
- `package.json` :
  - `build` = `prisma generate && next build` — **ne lance pas** de
    migration.
  - `migrate:deploy` = `prisma migrate deploy` — commande séparée,
    explicite.
- `.github/workflows/ci.yml` applique `npm run migrate:deploy` comme étape
  dédiée, avant le build, sur une base Postgres jetable créée pour chaque
  run CI (jamais une base partagée). Un commentaire daté du 24/09/2026 dans
  ce fichier documente que `npm run build` (donc tout build Vercel, Preview
  ou Production) n'exécute plus `prisma migrate deploy` automatiquement,
  précisément pour qu'un build ne puisse jamais appliquer une migration à
  l'insu de qui le déclenche.
- Aucun mécanisme de sauvegarde/restauration de base de données n'existe
  dans ce dépôt (aucun script, aucune documentation) — attendu : c'est la
  responsabilité du fournisseur d'hébergement Postgres choisi (§8, §9),
  jamais quelque chose à inventer côté application.

## 2. Principe directeur

Une migration en production est une étape **explicite, distincte du
déploiement applicatif, et jamais silencieuse**. Elle doit pouvoir être
: (a) déclenchée volontairement, (b) observée (succès/échec clair), (c)
diagnostiquée si elle échoue, sans jamais deviner l'état réel de la base à
partir de suppositions.

## 3. Procédure — initialiser une base neuve

Pour un tout premier déploiement (base vide, aucune ligne dans
`_prisma_migrations`) :

1. Avoir `DATABASE_URL` positionnée sur la base cible (jamais affichée en
   clair dans un log ou une sortie de commande partagée).
2. Exécuter `npm run migrate:deploy` (= `prisma migrate deploy`). Sur une
   base neuve, Prisma applique l'intégralité des 46 migrations dans
   l'ordre chronologique de leurs dossiers, et crée la table
   `_prisma_migrations` qui trace lesquelles ont été appliquées.
3. Vérifier la sortie de la commande : elle doit lister chaque migration
   appliquée avec succès et se terminer sans code d'erreur.
4. Exécuter le seed si nécessaire (`npm run seed` = `tsx prisma/seed.ts`)
   — uniquement pour peupler des comptes de démonstration, jamais requis
   pour qu'une base de production fonctionne.
5. Ne lancer le déploiement applicatif (build + démarrage) qu'après cette
   étape (voir §11 — ordre recommandé).

## 4. Comportement factuel de `prisma migrate deploy`

D'après la documentation officielle Prisma (`/docs/cli/migrate/deploy`,
paraphrasée depuis les résultats de recherche — accès direct bloqué) :

- Conçu pour les environnements non interactifs (CI/CD, production) —
  contrairement à `migrate dev`, il ne pose aucune question et ne
  régénère jamais de fichier de migration.
- Applique uniquement les migrations qui ne sont pas encore marquées comme
  appliquées dans `_prisma_migrations`, dans l'ordre de leurs dossiers.
- N'effectue jamais de reset de la base et ne supprime jamais de données
  (contrairement à `migrate dev` ou `migrate reset`, qui peuvent réinitialiser
  la base en développement).
- Ne lance jamais de script de seed lui-même.
- Si une migration échoue en cours d'application, la commande s'arrête,
  retourne un code d'erreur, et **cette migration précise** est marquée
  `failed` dans `_prisma_migrations` — c'est cet état qui déclenche
  l'erreur **P3009** ("migrate found failed migrations in the target
  database") sur toute tentative ultérieure de `migrate deploy`, tant que
  cet état n'a pas été résolu manuellement (§5, §6).
- Chaque migration s'exécute dans une transaction quand le moteur de base
  de données le permet (PostgreSQL le permet pour la plupart des
  instructions DDL) — mais certaines opérations (ex. `CREATE INDEX
  CONCURRENTLY`) ne peuvent pas être englobées dans une transaction ; dans
  ce cas une migration peut échouer après avoir partiellement appliqué des
  changements. Ce dépôt n'a pas été audité migration-par-migration pour
  repérer une éventuelle instruction non transactionnelle — à vérifier
  spécifiquement si une migration future en introduit une (voir §16,
  limites).

## 5. Détection et diagnostic d'une migration échouée (P3009)

**Symptôme observable :** `prisma migrate deploy` échoue avec un message
contenant `P3009` et le nom de la migration en cause, indiquant qu'une
migration précédente est dans un état `failed`.

**Démarche de diagnostic, dans l'ordre :**

1. **Ne rien exécuter d'autre immédiatement.** Ne pas relancer
   `migrate deploy` en boucle — cela ne résout rien tant que l'état
   `failed` n'est pas traité, et peut masquer le vrai message d'erreur
   sous des tentatives répétées.
2. Consulter le contenu de la table `_prisma_migrations` (`SELECT * FROM
   "_prisma_migrations" ORDER BY started_at DESC;`) pour identifier
   précisément quelle migration est marquée `failed` et à quel moment.
3. Lire le message d'erreur SQL complet retourné par la commande — il
   indique en général l'instruction SQL exacte qui a échoué (contrainte
   violée, colonne déjà existante, type incompatible, verrou, etc.).
4. Déterminer, en inspectant l'état réel du schéma de la base (`\d
   nom_table` en `psql`, ou un client SQL équivalent), si les
   instructions de cette migration ont été **partiellement appliquées**
   ou **pas appliquées du tout** avant l'échec. C'est cette
   constatation — jamais une supposition — qui conditionne l'étape
   suivante (§6).
5. Ne poursuivre qu'une fois cet état réel constaté et documenté.

## 6. `migrate resolve` — distinction critique, jamais à l'aveugle

`prisma migrate resolve` ne modifie **jamais** le schéma ou les données de
la base : il modifie uniquement l'entrée correspondante dans
`_prisma_migrations`, pour dire à Prisma "considère cette migration comme
traitée". L'opérateur doit avoir déjà réconcilié l'état réel de la base
**avant** d'appeler cette commande — jamais l'inverse.

Deux options mutuellement exclusives, jamais interchangeables :

- **`prisma migrate resolve --applied <nom_migration>`** — à utiliser
  uniquement si l'inspection (§5.4) a confirmé que **toutes** les
  instructions SQL de cette migration ont bien été appliquées avec succès
  à la base (par exemple : la migration a réellement réussi, mais un
  problème réseau/timeout a empêché Prisma de l'enregistrer correctement
  ; ou l'opérateur a réappliqué manuellement le reste du SQL manquant et
  confirmé son succès). Marque la migration comme appliquée avec succès —
  Prisma continuera avec la migration suivante au prochain `migrate
  deploy`.
- **`prisma migrate resolve --rolled-back <nom_migration>`** — à utiliser
  uniquement si l'inspection a confirmé que les effets de cette migration
  (complets ou partiels) ont été **annulés manuellement** de la base (SQL
  de compensation écrit et exécuté par l'opérateur, ou restauration
  depuis une sauvegarde antérieure à cette migration — §8). Marque la
  migration comme non appliquée — Prisma la retentera au prochain
  `migrate deploy`.

**Règle absolue :** si l'état réel de la base n'a pas été constaté avec
certitude (§5.4), ne lancer **ni** `--applied` ni `--rolled-back`. Une
mauvaise déclaration ici peut faire croire à Prisma qu'un schéma cohérent
existe alors qu'il ne l'est pas (ou l'inverse), corrompant la suite des
migrations. Dans le doute, s'arrêter et escalader (§7, Cas C).

## 7. Principes de récupération après incident

**Cas A — échec transactionnel propre** (l'instruction SQL a échoué avant
tout effet, la transaction a été annulée automatiquement par PostgreSQL) :
corriger le fichier de migration défectueux (jamais en le modifiant a
posteriori s'il a déjà été appliqué ailleurs — créer une nouvelle
migration corrective, voir la documentation officielle sur le "patching
and hotfixing", §14) ou corriger la cause (ex. contrainte de données
existante incompatible), puis `migrate resolve --rolled-back`, puis
`migrate deploy` à nouveau.

**Cas B — application partielle** (certaines instructions de la migration
ont réussi avant l'échec) : ne jamais supposer l'étendue de ce qui a été
appliqué — la constater (§5.4). Compenser manuellement les instructions
manquantes ou annuler celles déjà appliquées, selon ce qui est le plus sûr
pour les données réelles déjà en base, puis résoudre (§6) en conséquence
de cette constatation, jamais avant.

**Cas C — incident sévère** (l'état réel de la base est incertain, les
effets ne peuvent pas être déterminés avec confiance, ou des données de
production réelles sont en jeu) : séquence stricte —

1. **STOP** — ne relancer aucune commande Prisma tant que l'état n'est
   pas compris.
2. **BACKUP** — obtenir une sauvegarde de l'état actuel de la base avant
   toute action corrective (voir §8 — via le fournisseur, jamais improvisé
   ici).
3. **DIAGNOSTIC** — répéter §5 avec tout le temps nécessaire ; si besoin,
   solliciter un accès direct à la base par un opérateur humain plutôt que
   de deviner.
4. **RÉPARATION ou RESTAURATION** — soit corriger l'état de la base pour
   qu'il corresponde à un point cohérent connu, soit restaurer depuis une
   sauvegarde antérieure à l'incident.
5. **RESOLVE** — une fois, et seulement une fois, l'état réel constaté et
   cohérent avec l'une des deux options du §6.
6. **MIGRATE DEPLOY** — reprendre l'application normale des migrations
   restantes.
7. **VÉRIFICATION** — appliquer la checklist du §13 avant de considérer
   l'incident clos.

Ce runbook ne remplace jamais un jugement humain sur un incident réel de
production — il structure la démarche, il ne l'automatise pas.

## 8. Sauvegarde et restauration — hors périmètre applicatif

Ce dépôt ne contient et n'a jamais contenu de mécanisme de sauvegarde ou
de restauration de base de données — ce n'est pas un oubli à corriger
ici : c'est la responsabilité du fournisseur d'hébergement Postgres retenu
pour la production (ex. sauvegardes automatiques + point-in-time recovery
proposées par Supabase, Neon, Render, RDS...). **Aucune fonctionnalité de
ce type n'est inventée dans ce lot.** Avant tout premier déploiement de
production réel, le fondateur doit confirmer explicitement, pour le
fournisseur retenu : la fréquence des sauvegardes automatiques, la
fenêtre de rétention, et la procédure de restauration (self-service ou
support). Statut actuel : **UNKNOWN — FOURNISSEUR NON ENCORE
SÉLECTIONNÉ** (voir Lot 12/13 : aucun projet Supabase de production
identifié à ce jour).

## 9. `directUrl` et pooler de connexions

`prisma/schema.prisma` ne déclare aucun `directUrl` — une seule URL
(`DATABASE_URL`) sert à la fois aux requêtes applicatives et aux
migrations. Ceci n'est un problème que si l'URL de connexion utilisée en
production passe par un pooler de connexions (ex. PgBouncer, Supabase en
mode "Transaction pooling", Neon pooled connections) qui ne supporte pas
les instructions DDL/transactionnelles nécessaires à `migrate deploy` — de
nombreux fournisseurs recommandent alors une URL directe (non poolée)
spécifiquement pour les migrations, via `directUrl` dans le bloc
`datasource` (voir doc officielle citée en §14).

Statut actuel : **UNKNOWN — FOURNISSEUR NON ENCORE SÉLECTIONNÉ.** Aucune
action requise tant qu'aucun fournisseur de production n'est choisi. Une
fois choisi : vérifier explicitement sa documentation sur ce point avant
le premier `migrate deploy` réel, et ajouter `directUrl` si le fournisseur
l'exige — cette modification de `prisma/schema.prisma` n'est **pas**
faite dans ce lot (hors périmètre explicite de Lot 14.2).

## 10. Isolation Production / Preview / CI

Constat actuel (Lot 12, confirmé ici) :

- **CI** : base Postgres 16 jetable, créée et détruite à chaque run
  (`.github/workflows/ci.yml`), `DATABASE_URL` fixée en dur dans le
  workflow vers cette base jetable locale au runner — aucun risque de
  collision avec une base réelle.
- **Preview/Production Vercel** : aucun projet Vercel réel identifié à ce
  jour (Lot 13, `BLOCKED — VERCEL ACCESS UNAVAILABLE`) — cette isolation
  n'existe donc pas encore concrètement, elle reste à mettre en place au
  moment du premier déploiement réel.

**Recommandation (non appliquée, décision future) :** au moment de
configurer un vrai projet Vercel, chaque environnement (Production,
Preview) doit recevoir sa **propre** valeur de `DATABASE_URL` (bases
distinctes) dans les variables d'environnement Vercel, jamais une base
partagée entre Preview et Production — c'est précisément le risque que le
commentaire du 24/09/2026 dans `ci.yml` anticipe déjà en retirant les
migrations automatiques du build.

## 11. Ordre recommandé de déploiement

1. `migrate:deploy` sur la base cible, exécuté explicitement et
   séparément (jamais par le build).
2. Vérifier le succès de cette étape (sortie de commande, §13) avant de
   continuer.
3. Build + démarrage de l'application (`npm run build && npm run start`,
   ou l'équivalent Vercel).
4. Vérification post-déploiement (§13).

Ne jamais démarrer l'application avant d'avoir confirmé que la migration
a réussi : une application démarrée contre un schéma de base incomplet ou
incohérent peut produire des erreurs difficiles à distinguer d'un bug
applicatif.

## 12. Scénario — migration réussie, déploiement applicatif échoué

Si `migrate deploy` réussit mais que le build ou le démarrage de
l'application échoue ensuite (erreur de build, crash au démarrage,
dépendance manquante...) : **ne jamais relancer ni annuler la
migration** — elle a réussi, l'état de la base est cohérent et à jour.
Le problème est uniquement applicatif. Diagnostiquer et corriger le
déploiement applicatif (nouveau build, correction de code, nouvelle
tentative de déploiement) sans toucher aux migrations ni à
`_prisma_migrations`. Une migration réussie reste valide même si de
nombreuses tentatives de déploiement applicatif échouent après elle.

## 13. Checklist de vérification post-migration

- [ ] La commande `migrate deploy` s'est terminée sans code d'erreur.
- [ ] Aucune ligne `failed` dans `_prisma_migrations` pour la base cible.
- [ ] Le nombre de lignes dans `_prisma_migrations` correspond au nombre
  de dossiers dans `prisma/migrations/` (actuellement 46).
- [ ] `GET /api/health` répond `{"status":"ok"}` une fois l'application
  démarrée (endpoint créé en Lot 12.1 — ne vérifie pas la base par
  conception, uniquement que le processus applicatif répond).
- [ ] Un test manuel simple de lecture/écriture via l'application (ex.
  connexion avec un compte existant) fonctionne sans erreur 500.
- [ ] Aucune valeur de secret (`SESSION_SECRET`, `DATABASE_URL`,
  `RESEND_API_KEY`...) n'a été affichée dans un log ou une sortie de
  commande partagée pendant l'opération.

## 14. Sources officielles citées

Accès direct à `www.prisma.io` bloqué depuis cet environnement
(`EGRESS_BLOCKED`) — les URLs ci-dessous sont les pages officielles
identifiées via recherche web, à relire directement avant toute
application réelle en production :

- `https://www.prisma.io/docs/cli/migrate/deploy` — comportement de
  `prisma migrate deploy`.
- `https://www.prisma.io/docs/cli/migrate/resolve` — `migrate resolve
  --applied` / `--rolled-back`.
- `https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing`
  — création d'une migration corrective plutôt que modification d'une
  migration déjà appliquée ailleurs.
- `https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production`
  — séparation des workflows `migrate dev` (développement) / `migrate
  deploy` (production).

## 15. Décision — `DEPLOIEMENT_DEMO_EN_LIGNE.md`

Ce guide affirmait (avant correction dans ce lot) que Vercel "crée les
tables automatiquement (`prisma migrate deploy` est lancé au build)".
C'est factuellement obsolète depuis le fix du 24/09/2026 documenté dans
`.github/workflows/ci.yml` : `npm run build` ne lance plus
`migrate deploy`. La phrase a été corrigée (voir diff) pour refléter
l'état réel du code — **rien d'autre dans ce guide n'a été modifié**,
conformément au périmètre de ce lot.

**Gap opérationnel non résolu, mis en évidence par cette correction et
nécessitant une décision du fondateur (hors périmètre de ce lot) :** ce
guide s'adresse explicitement à quelqu'un "sans rien installer" (aucun
terminal). Or, `migrate:deploy` n'étant plus automatique, une première
installation suivant ce guide à la lettre déploierait une application
sans aucune table créée en base — un premier déploiement sans terminal
n'a aujourd'hui aucun moyen d'appliquer les migrations. Ce lot ne propose
et n'implémente aucune solution (créer une route de migration à la
`/api/dev-seed` serait une nouvelle surface applicative, hors périmètre
et non autorisée ici) : ce gap est signalé pour décision, pas traité.

## 16. Limites de ce runbook

- N'a pas été validé contre un incident réel — c'est une préparation
  théorique fondée sur la documentation officielle et l'audit du code
  actuel, pas un retour d'expérience.
- N'audite pas le contenu SQL des 46 migrations une par une pour repérer
  une éventuelle instruction non transactionnelle (§4) — à faire si une
  migration future en introduit une, ou avant un premier déploiement de
  production réel.
- Suppose PostgreSQL comme moteur cible (confirmé dans
  `prisma/schema.prisma`) — un autre moteur pourrait avoir un comportement
  transactionnel différent pour les migrations.
- Ne couvre pas le choix d'un fournisseur d'hébergement de base de données
  ni la configuration de ses sauvegardes (§8, §9) — décisions du
  fondateur, non prises dans ce lot.

## 17. Historique du document

- Créé — Lot 14.2 (29/09/2026), en réponse au `BLOCKED — PRODUCTION
  PREREQUISITE MISSING` du Lot 14 sur l'absence de procédure de reprise
  en cas d'échec de migration en production.
