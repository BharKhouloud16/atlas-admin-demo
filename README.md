# Atlas Quality Partners — plateforme admin + espace client (starter)

Deux modules publics sur le site :
- **`/connexion`** — pour les 3 rôles (Admin, Ingénieur, Client)
- **`/inscription`** — publique, pour Ingénieur ou Client uniquement (l'Admin
  n'est jamais créé par inscription, voir `prisma/create-admin.ts`)

**Statut : starter à assembler, pas prêt à déployer tel quel** — voir la
section "Ce qui reste à faire" plus bas. Non testé en conditions réelles
(pas d'accès réseau dans l'environnement où ce code a été écrit).

## Les 3 profils

| Rôle | Comment le compte existe | Voit | Génère des contrats |
|---|---|---|---|
| **ADMIN** | Créé manuellement (`create-admin.ts`) | Tout : clients, profils, coûts internes, marges, comptes en attente | Oui — les 5 modèles (fonctionnalités financières et juridiques) |
| **INGENIEUR** | S'inscrit sur `/inscription`, **inactif jusqu'à validation Admin** | Ses propres missions uniquement (client, jours, statut) — aucun tarif | Non |
| **CLIENT** | S'inscrit sur `/inscription`, **inactif jusqu'à validation Admin** | Son espace `/client` : suivi de ses missions + ses documents (rapports, contrats, factures) | Non |

### Le circuit d'inscription

1. L'ingénieur ou le client s'inscrit sur `/inscription` → un compte est créé
   avec `actif = false`. Un ingénieur obtient une fiche `Profil` vide (sans
   tarif), un client obtient une fiche `Client`.
2. Il ne peut pas se connecter tant que `actif = false` (message explicite
   au login).
3. L'Admin voit tous les comptes en attente sur `/admin/comptes-en-attente`.
   Pour un ingénieur, il fixe à ce moment-là le type de contrat et le
   montant (négociés hors ligne) puis valide → `actif = true`.
4. Le compte peut alors se connecter et accède à son espace.

Ce filtrage est appliqué à trois niveaux, jamais côté affichage seul :
- **`actif`** en base : bloque la connexion elle-même.
- **Middleware** (`middleware.ts`) : bloque l'accès aux pages/routes selon le rôle.
- **Routes API** : ne renvoient jamais les champs qu'un rôle ne doit pas voir
  (ex. un ingénieur n'a jamais `tjmVente` dans la réponse JSON, ce n'est pas
  juste caché en CSS).

## Ce qui est déjà fait

- Modèle de données (`prisma/schema.prisma`) : `User` (compte de connexion,
  3 rôles), `Client`, `Profil`, `Mission`, `Document`, `Hypotheses`
- Authentification par session (cookie httpOnly + JWT)
- Inscription publique + file d'attente de validation Admin
- Middleware de protection par rôle sur `/admin/*`, `/client/*` et les API
- Espace client : suivi des missions (`/client`) + liste de documents
  téléchargeables
- Génération de contrats Word réservée à l'Admin (`/api/generate-contract`,
  5 modèles déjà préparés avec balises dans `/templates`)

## Ce qui reste à faire avant mise en production

1. **`npm install`**, créer une base PostgreSQL (Supabase/Neon/Render),
   copier `.env.example` → `.env`, `npm run prisma:migrate`.
2. **Créer votre compte Admin** :
   `npx tsx prisma/create-admin.ts vous@atlas-qa.com votre_mot_de_passe`
3. **Brancher le stockage des documents** : `Document.fileUrl` suppose un
   stockage externe (Supabase Storage, S3...) — il n'y a pas encore de route
   d'upload ; à ajouter dans `/admin` pour que l'Admin dépose les rapports
   et factures des clients.
4. **Construire `/admin/clients` et `/admin/profils`** (formulaires
   d'ajout/édition) — pour l'instant seules les routes API existent.
5. **Emails transactionnels** : prévenir un utilisateur quand son compte est
   validé (aujourd'hui, il doit revenir tester lui-même).
6. **Déployer** sur Vercel (frontend/API) + Supabase/Neon (base).

## Sécurité — points à ne pas sauter

- `SESSION_SECRET` long et aléatoire, différent en dev/prod
  (`openssl rand -base64 32`).
- Le circuit de validation manuelle des comptes est la seule barrière
  contre une inscription frauduleuse (ex. un concurrent qui se fait passer
  pour un client) — ne l'automatisez pas sans vérification d'identité.
- Les documents clients (rapports d'audit, failles identifiées) sont des
  données très sensibles : chiffrement au repos sur le stockage de fichiers,
  URLs signées à durée limitée plutôt que des liens publics permanents.
- Faites relire cette architecture par quelqu'un qui fait du Next.js en
  production avant d'y mettre de vraies données clients.
