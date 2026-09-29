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

Le stockage de documents (Vercel Blob), les pages `/admin/clients` et
`/admin/profils`, et les emails transactionnels (Resend, avec repli en
mode démo si non configuré) sont déjà implémentés — voir `.env.example`
pour la liste complète des variables. Ce qui reste réellement à valider
avant d'accueillir un premier Client réel :

1. **Déployer sur un projet Vercel dédié**, avec sa propre base
   PostgreSQL — jamais le même `DATABASE_URL` qu'un déploiement Preview.
   `npm run build` n'exécute plus `prisma migrate deploy` automatiquement
   (corrigé le 24/09/2026, voir `package.json` — les migrations sont
   désormais une étape explicite via `npm run migrate:deploy`), mais une
   base partagée reste à éviter par principe.
2. **Configurer `RESEND_API_KEY`** pour un envoi d'email réel — sans elle,
   les emails sont seulement journalisés (voir `lib/email.ts`). Le parcours
   Admin-crée-un-Client (`/admin/clients`) fonctionne sans email : le mot
   de passe temporaire est affiché une fois dans l'interface.
3. **Configurer `SENTRY_DSN`** pour capturer les erreurs serveur réelles
   (voir `instrumentation.ts`) — sans elle, une erreur non instrumentée ne
   laisse aucune trace durable.
4. **Créer le premier compte ADMIN** via `npx tsx prisma/create-admin.ts
   <email> <mot_de_passe>`, exécuté par un opérateur depuis un terminal
   avec `DATABASE_URL` pointant vers la base réelle (LOT 15.2 : il n'existe
   plus de route HTTP publique pour cela — `/api/dev-seed` a été retiré).

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
