# Obtenir un lien de démo en ligne — sans rien installer

Tout se fait dans le navigateur : GitHub, Supabase, Vercel. 15-20 minutes.

## 1. Mettre le code sur GitHub

1. Dézippez `atlas-admin-starter.zip` sur votre ordinateur (juste pour
   pouvoir sélectionner les fichiers — aucune commande à taper).
2. Allez sur [github.com/new](https://github.com/new), créez un repo (ex.
   `atlas-admin-demo`), laissez-le vide, cliquez "Create repository".
3. Sur la page du repo vide, cliquez "uploading an existing file", puis
   **glissez-déposez tout le contenu du dossier dézippé** (pas le zip
   lui-même — son contenu) dans la zone. Attendez que tout soit listé,
   puis "Commit changes".

## 2. Créer la base de données sur Supabase

1. [supabase.com](https://supabase.com) → New project (compte gratuit).
2. Une fois créé : Settings → Database → copiez la "Connection string"
   en mode **Transaction** (commence par `postgresql://postgres...`).
   Remplacez `[YOUR-PASSWORD]` dedans par le mot de passe que vous avez
   choisi à la création du projet.

## 3. Déployer sur Vercel

1. [vercel.com/new](https://vercel.com/new) → connectez votre compte
   GitHub → sélectionnez le repo `atlas-admin-demo`.
2. Avant de cliquer "Deploy", ouvrez "Environment Variables" et ajoutez :
   - `DATABASE_URL` = la connection string Supabase de l'étape 2
   - `SESSION_SECRET` = n'importe quelle longue chaîne aléatoire (ex.
     tapez sur votre clavier n'importe quoi de 40 caractères)
3. Cliquez "Deploy". Vercel installe les dépendances et build
   l'application, et vous donne une URL du type
   `https://atlas-admin-demo.vercel.app`. **Important : ceci ne crée pas
   encore les tables** — depuis un correctif du 24/09/2026, le build ne
   lance plus `prisma migrate deploy` automatiquement (voir
   `docs/PRODUCTION_MIGRATION_RUNBOOK.md`), pour éviter qu'un build
   applique des migrations à l'insu de qui le déclenche. L'étape suivante
   (données de démo) échouera tant que les tables n'existent pas — voir
   avec la personne qui a préparé ce guide comment les créer dans votre
   cas avant de continuer.

## 4. Créer les comptes (nécessite désormais un terminal, une fois)

**Ce guide était conçu pour ne jamais nécessiter de terminal**, via une
route qui permettait de peupler la base depuis le navigateur. Cette route
a été retirée (LOT 15.2, 29/09/2026) : elle exposait publiquement, en
permanence, un mécanisme capable de créer des comptes — jugé trop risqué
pour un vrai déploiement. Il n'existe donc plus, à ce stade, de mécanisme
de création de comptes accessible uniquement depuis le navigateur — ce
point n'a volontairement pas été résolu par ce lot (voir son rapport pour
la décision à prendre sur l'avenir de ce guide).

En attendant cette décision, un bref accès terminal est nécessaire pour
continuer :

1. Sur votre ordinateur : récupérez le même code que celui déposé sur
   GitHub à l'étape 1, puis `npm install`.
2. Pour créer uniquement un compte ADMIN fonctionnel sur la vraie base :
   ```
   DATABASE_URL="<la connection string Supabase de l'étape 2>" npx tsx prisma/create-admin.ts admin@votre-domaine.example <mot-de-passe-de-votre-choix>
   ```
3. Pour un jeu de données de démonstration complet (Client, Ingénieur,
   Mission), vous pouvez à la place exécuter :
   ```
   DATABASE_URL="<la même connection string>" npx tsx prisma/seed.ts
   ```
   **Attention** : ce script est prévu pour un environnement de
   démonstration/local — il fixe le mot de passe de tous les comptes créés
   à `Demo1234`. Ne l'exécutez jamais sur une base contenant déjà de
   vraies données clients.

## 5. Tester

Allez sur `https://atlas-admin-demo.vercel.app/connexion` et connectez-vous
avec le compte ADMIN créé à l'étape 4.2. Si vous avez plutôt exécuté
`prisma/seed.ts` (étape 4.3), les comptes suivants existent aussi (mot de
passe unique : `Demo1234`) :

| Email | Rôle |
|---|---|
| `admin-demo@example.com` | ADMIN — voit tout, génère les contrats |
| `client-demo@example.com` | CLIENT — son espace suivi + documents |
| `ingenieur-demo@example.com` | INGENIEUR — ses missions, sans tarif |
| `en-attente-demo@example.com` | ne peut pas se connecter — utile pour tester la validation depuis le compte Admin |

## Si le build Vercel échoue

Le message d'erreur s'affiche directement dans l'onglet "Deployments" de
Vercel. Copiez-le-moi tel quel, je n'ai pas pu tester ce déploiement moi-même
faute d'accès réseau — la première tentative réelle sera la vôtre, et
c'est normal qu'il faille ajuster quelque chose au premier essai.

## Important

`prisma/seed.ts` (étape 4.3) est fait pour une **démo**, avec un mot de
passe fixe (`Demo1234`) — jamais pour une mise en production réelle avec
de vraies données clients. Pour une vraie mise en production, n'utilisez
que `prisma/create-admin.ts` (étape 4.2), avec un mot de passe unique de
votre choix.
