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
   - `SEED_TOKEN` = une autre chaîne aléatoire, notez-la de côté
3. Cliquez "Deploy". Vercel installe les dépendances, crée les tables
   automatiquement (`prisma migrate deploy` est lancé au build) et vous
   donne une URL du type `https://atlas-admin-demo.vercel.app`.

## 4. Remplir les données de démo (toujours sans terminal)

Ouvrez dans votre navigateur, en remplaçant par votre URL et votre
`SEED_TOKEN` :

```
https://atlas-admin-demo.vercel.app/api/dev-seed?token=VOTRE_SEED_TOKEN
```

Vous devez voir un message JSON confirmant la création des comptes de
démo. C'est fait.

## 5. Tester

Allez sur `https://atlas-admin-demo.vercel.app/connexion` et connectez-vous
avec (mot de passe unique : `Demo1234`) :

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

Ce chemin (route `/api/dev-seed`, `SEED_TOKEN`) est fait pour une **démo**,
pas pour la mise en production réelle avec vos vraies données clients —
supprimez cette route avant d'aller plus loin.
