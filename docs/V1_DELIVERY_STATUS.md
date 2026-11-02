# ATLAS V1 — état de livraison

Branche : `v1/delivery` (base : `fix/build-no-migrate-minimal` / PR #56, `b389107`) — PR #57 (brouillon).
Dernière mise à jour : 19/10/2026.

Ce document distingue strictement ce qui est **démontré** (preuve citée) de ce qui est **supposé** ou **bloqué**.

## 1. Point de départ vérifié

| Élément | État constaté | Preuve |
|---|---|---|
| `main` | `f51573e` (V2.5 Communication Intelligence) | `git log` |
| PR #56 `fix/build-no-migrate-minimal` | 3 commits : build sans `migrate deploy`, étape CI de migration explicite, Node 22 | `git diff main...` (2 fichiers : `package.json`, `.github/workflows/ci.yml`) |
| PR #55 `fix/build-no-automatic-migrate` | 375 fichiers / +61 k lignes par rapport à `main` : fonctionnalités non fusionnées (A32, A34, DB08, Engineer Access & Trust…) **et** correctifs d'authentification | `git diff --stat main...` |
| Builds Preview du 19/10 (`433fcd8`, `9d56ed6`, `b389107`) | READY ; journaux : `prisma generate && next build`, aucun `migrate deploy`, aucune ligne `Datasource`, aucune P3009 | journaux de build Vercel (lus via l'API du tableau de bord, valeurs masquées) |
| Variables Vercel `DATABASE_URL` | deux variables distinctes (Production modifiée le 24/09, Preview le 27/09), type *Sensitive* : non relisibles | API Vercel (métadonnées uniquement) |
| Supabase `atlas-preview` | actif ; aucune connexion applicative entre 11:27 et 11:37 UTC le 19/10 ; dernières connexions pooler à 08:19 et 08:37 UTC | Logs Explorer Supabase (lecture seule) |
| Branche locale `fix/v1-login-resilience` | **introuvable** sur le dépôt distant ; non utilisée | `git branch -r` |

## 2. Corrections intégrées sur `v1/delivery`

| # | Problème | Cause démontrée | Correction | Commit | Test de non-régression |
|---|---|---|---|---|---|
| 1 | Le build Vercel appliquait les migrations (P3009 bloquait tout déploiement) | `"build": "prisma generate && prisma migrate deploy && next build"` | Repris de PR #56 : build sans migration, `npm run migrate:deploy` explicite | `433fcd8`, `9d56ed6`, `b389107` | journaux des 3 builds Preview |
| 2 | Bouton « Connexion… » bloqué après une erreur réseau / réponse illisible / délai | `setLoading(false)` jamais atteint si `fetch`/`res.json()` lève | Repris de PR #55 : `try/catch/finally` + `AbortController` 15 s | `1db15c9`, `1b82882` (repris de `8a060ec`, `0f6e08f`, `edd187f`) | `tests/e2e/connexion.spec.ts` |
| 3 | `/api/auth/login` et `/signup` : exception non gérée quand la base est injoignable (incident `PrismaClientInitializationError … tenant/user … not found`) | aucune gestion d'erreur autour des appels Prisma | 503 JSON `SERVICE_INDISPONIBLE` + `Retry-After`, 500 JSON générique sinon ; journalisation limitée au type/code (jamais le message Prisma) — `lib/db-errors.ts`, `lib/api-errors.ts` | `a0062f2`, `9858542`, `c006170` | `tests/unit/api-errors.spec.ts` |
| 4 | Corps non-JSON sur login/signup → 500 | `await req.json()` non protégé | 400 JSON `Requête invalide.` | `9858542`, `c006170` | `tests/api/auth.spec.ts` |
| 5 | Inscription : Profil/Client orphelin si la création du User échoue (ex. inscription concurrente) | deux écritures hors transaction | `prisma.$transaction` ; P2002 → 409 | `c006170` | couvert par la suite API existante (inscription) |
| 6 | Impossible d'établir la base utilisée à l'exécution par Production/Preview | variables *Sensitive*, journaux de build sans connexion | `GET /api/sante` : `SELECT 1` en lecture seule + empreinte SHA-256 tronquée de la référence Supabase (aucun secret) — `lib/db-target.ts` | `a0062f2`, `100c891` | `tests/unit/db-target.spec.ts`, `tests/api/sante.spec.ts` |
| 7 | Réimporter un CV **supprimait toutes les informations validées** par l'ingénieur | `infoCV.deleteMany({ profilId })` puis recréation brute | seules les infos non validées sont remplacées ; un champ validé n'est jamais recréé — `lib/cv-fusion.ts` | `a0062f2`, `582d4ba` | `tests/unit/cv-fusion.spec.ts` |
| 8 | Import CV : type vérifié sur le MIME déclaratif seulement (vide accepté), pas de limite de taille, détail de configuration du stockage renvoyé au navigateur, URL Blob privée renvoyée | contrôles absents | signature `%PDF-`, vide → 400, > 10 Mo → 413, stockage indisponible → 503 générique, URL non renvoyée | `582d4ba` | `tests/api/v1-cv-import.spec.ts` |
| 9 | Page d'import CV annonçait « PDF ou Word » alors que le serveur refuse Word ; bouton bloqué après erreur réseau | incohérence UI/serveur ; pas de `finally` | PDF uniquement ; `try/catch/finally` | `5338602` | — (UI) |
| 10 | CI #336 : 1 test sur 1387 en échec (« mot de passe erroné ») | limiteur de connexion par IP : **602** tentatives mesurées pendant la suite (`login:::1`) pour un seuil CI de 600 → 429 au lieu de 401 (mesure en base CI, run #337) | seuil CI relevé à 1000 (Production inchangée : 20 / 15 min) + étape CI qui mesure la consommation à chaque run | `9d7a705` | run #337 : 1387/1387 |

Non repris de PR #55 : fonctionnalités non fusionnées (A32, A34, DB08, Engineer Access & Trust…). Elles changent le comportement métier (ex. un ingénieur `actif=false` peut se connecter en accès limité) et nécessitent une décision produit et une revue séparée.

## 3. Migrations

* Les 45 migrations du dépôt s'appliquent **sans erreur, dans l'ordre**, sur une base PostgreSQL 16 vierge (exécution locale `psql -v ON_ERROR_STOP=1`, 49 tables créées). L'historique est donc cohérent ; la P3009 de Production est un problème d'**état de la base**, pas du code.
* La migration `20260910000000_rapport_agent_reconciliation` crée `StatutRapportAgent`, `RapportAgent`, 3 index et 1 FK. Si la base contient déjà ces objets (objets B18 orphelins signalés le 23/09), `CREATE TYPE` échoue → migration marquée en échec → P3009.
* Diagnostic non destructif prêt : `scripts/diagnostic-migrations.sql` (transaction `READ ONLY`, testé localement).
* Procédure de récupération (**non exécutée — autorisation requise**) :
  1. Sauvegarde `pg_dump` de la base cible + test de restauration sur une base jetable.
  2. Exécuter `scripts/diagnostic-migrations.sql`.
  3. Si **tous** les objets existent avec exactement la structure de la migration → `prisma migrate resolve --applied 20260910000000_rapport_agent_reconciliation`.
     Si **aucun** n'existe → `prisma migrate resolve --rolled-back …` puis `npm run migrate:deploy`.
     Si l'état est **partiel ou différent** → ne rien résoudre ; écrire une migration corrective dédiée après revue.
  4. `npm run migrate:deploy` (applique les migrations suivantes), puis vérifier `GET /api/sante`.

## 4. Environnements

| Environnement | Base ciblée | Statut |
|---|---|---|
| Local (cette session) | PostgreSQL 16 local jetable (`localhost`) | migrations appliquées sans erreur |
| GitHub Actions | service `postgres:16` jetable du run | défini dans `ci.yml` |
| Vercel Preview | **`atlas-preview`** (empreinte `49f2c2496085c867`), base joignable | **démontré** : `GET /api/sante` sur le déploiement Preview `b74677d` → `{"environnement":"preview","base":"ok","cible":{"libelle":"supabase-atlas-preview"}}` |
| Vercel Production | **indéterminée** ; dernier déploiement Production réussi : 09/09 (`dbaed4e`) ; aucun déploiement depuis le 24/09 | erreur runtime observée : `tenant/user postgres.<ref historique> not found` (projet historique suspendu) |

Empreintes connues (`lib/db-target.ts`) : `2f97519aeaf98180` = Supabase historique, `49f2c2496085c867` = `atlas-preview`.

## 5. Tests

Contrainte de cette session : le registre npm est **bloqué** par le proxy réseau (`registry.npmjs.org` → 403). `npm install`, `tsc`, `next build` et Playwright ne peuvent pas s'exécuter localement ; ils sont exécutés par la CI GitHub Actions sur la PR.

Vérifications locales réellement exécutées :
* `lib/db-errors.ts`, `lib/db-target.ts`, `lib/cv-fusion.ts` : compilation TypeScript stricte (`tsc --strict`) et exécution des cas nominaux et limites sous Node 22 → conformes.
* Migrations : 45/45 appliquées sur base vierge.
* `scripts/diagnostic-migrations.sql` : exécuté sur la base locale → conforme.

Résultats CI (GitHub Actions, base PostgreSQL 16 jetable, PR #57) :

| Run | Commit | TypeScript (`tsc --noEmit`) | Migrations | Build production | Playwright (unitaires + API + E2E) |
|---|---|---|---|---|---|
| #336 | `b74677d` | ✅ | ✅ 45/45 | ✅ | ❌ 1386 réussis / 1 échec / 0 ignoré — cause : limiteur de connexion (correction n° 10) |
| #337 | `9d7a705` | ✅ | ✅ 45/45 | ✅ | ✅ **1387 réussis / 0 échec / 0 ignoré** |

Nouveaux tests de cette livraison, tous réussis en #337 : `tests/unit/api-errors.spec.ts` (5), `tests/unit/db-target.spec.ts` (5), `tests/unit/cv-fusion.spec.ts` (4), `tests/api/sante.spec.ts` (1), `tests/api/v1-cv-import.spec.ts` (5), cas non-JSON de `tests/api/auth.spec.ts` (1), cas réseau de `tests/e2e/connexion.spec.ts` (1).

Vérifications sur le déploiement Vercel Preview `b74677d` (sans authentification, lecture seule) :
* build Vercel READY (inclut la vérification TypeScript de `next build`) ;
* `GET /api/sante` → 200, `base: ok`, cible `supabase-atlas-preview` ;
* `POST /api/auth/login` et `/signup` avec un corps non-JSON → 400 `{"error":"Requête invalide."}` ;
* `/api/profils`, `/api/clients`, `/api/ingenieur/profil`, `/api/client/missions`, `/api/journal`, `/api/talent/besoins`, `/api/quality` sans session → 403.

**Non exécuté** : parcours navigateur authentifiés (Admin, Client, Ingénieur) sur la Preview. Ils sont couverts en CI sur base jetable (`tests/e2e/*`, `tests/setup/auth.setup.ts`), mais pas rejoués sur la Preview : la session de travail n'est pas autorisée à saisir des mots de passe sur un hôte qui n'est ni local ni explicitement désigné comme environnement de test. À faire par le propriétaire (ou en désignant explicitement l'hôte Preview comme environnement de test).

## 6. Blocages et autorisations requises

| Blocage | Impact | Action nécessaire (propriétaire) |
|---|---|---|
| Projet Supabase historique suspendu (`tenant/user … not found`) | Production ne peut pas se connecter à sa base | Décider : réactiver ce projet (après sauvegarde) **ou** désigner une nouvelle base de Production. Ne pas rediriger Production vers `atlas-preview` sans décision. |
| P3009 sur la base de Production | tout déploiement Production qui applique les migrations échoue | Autoriser la procédure §3 (sauvegarde → diagnostic → `resolve` justifié). |
| Cible runtime Production inconnue | impossible de prouver quelle base Production utilise | `/api/sante` n'existe qu'à partir de cette branche : la cible Production sera lisible au premier déploiement Production autorisé (lecture seule). Preview : établie (`atlas-preview`). |
| Stockage Blob absent en CI | le parcours complet d'import de CV (stockage + extraction IA) ne peut être testé qu'en Preview avec `BLOB_READ_WRITE_TOKEN` et `ANTHROPIC_API_KEY` | Tester en Preview avec un compte de test identifiable. |
| Accès GitHub en écriture de la session | commits publiés via l'interface web GitHub | — |
| Fusion dans `main`, déploiement Production | interdits sans autorisation | Revue puis fusion de la PR par le propriétaire. |
