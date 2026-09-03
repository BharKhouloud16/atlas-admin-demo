# Tester en démo — le chemin le plus rapide

Ce guide sert uniquement à cliquer dans l'application sur votre machine,
pas à la mettre en ligne. Il faut avoir Node.js installé (18+), et soit
Docker, soit un compte Supabase gratuit.

## Option A — Docker (le plus rapide, aucun compte à créer)

```bash
# 1. Lancer une base Postgres locale
docker run --name atlas-demo -e POSTGRES_PASSWORD=demo -p 5432:5432 -d postgres

# 2. Installer les dépendances
unzip atlas-admin-starter.zip && cd atlas-admin-starter
npm install

# 3. Configurer l'environnement
cp .env.example .env
```
Dans `.env`, mettez :
```
DATABASE_URL="postgresql://postgres:demo@localhost:5432/postgres"
SESSION_SECRET="demo-secret-a-changer-en-production"
```

```bash
# 4. Créer les tables
npm run prisma:migrate

# 5. Remplir avec des données de démo (client, ingénieur, mission, un
#    compte en attente pour tester la validation)
npm run seed

# 6. Lancer le site
npm run dev
```

Ouvrez **http://localhost:3000/connexion**.

## Option B — Sans Docker (Supabase gratuit)

Remplacez l'étape 1 par : créez un projet sur supabase.com, récupérez la
"Connection string" (Settings → Database), collez-la dans `DATABASE_URL`.
Le reste est identique.

## Comptes de test (mot de passe unique : `Demo1234`)

| Email | Rôle | Ce que vous devez voir |
|---|---|---|
| `admin-demo@example.com` | ADMIN | Tout : clients, profils, missions avec tarifs et marges, comptes en attente |
| `client-demo@example.com` | CLIENT | `/client` : la mission "Audit Q4 2026" en suivi, aucun document pour l'instant (normal, rien n'a encore été déposé) |
| `ingenieur-demo@example.com` | INGENIEUR | `/admin/missions` : sa mission, sans aucun tarif visible |
| `en-attente-demo@example.com` | INGENIEUR (inactif) | Ne peut PAS se connecter — message "en attente de validation". Utilisez le compte Admin pour aller le valider sur `/admin/comptes-en-attente`, puis reconnectez-vous avec ce compte : il doit maintenant fonctionner. |

## Ce qui vaut la peine d'être testé en priorité

1. **Le circuit d'inscription complet** : allez sur `/inscription`,
   créez un nouveau compte client ou ingénieur vous-même, vérifiez qu'il
   apparaît bien dans `/admin/comptes-en-attente` (connecté en Admin),
   validez-le, reconnectez-vous avec.
2. **L'étanchéité des rôles** : connectez-vous en Ingénieur, vérifiez que
   vous ne voyez jamais de TJM ni de marge nulle part (même en inspectant
   les requêtes réseau du navigateur — c'est le vrai test).
3. **La génération de contrat** : en Admin, sur `/admin/missions`, générez
   un "Contrat de prestation" pour la mission de démo — le `.docx` doit se
   télécharger avec "Client Démo SAS" déjà rempli dedans.

## Si quelque chose ne fonctionne pas

Dites-moi le message d'erreur exact (terminal ou navigateur) — je n'ai pas
pu exécuter ce code moi-même (pas d'accès réseau dans mon environnement),
donc la première vraie exécution sera la vôtre, et c'est là que des
ajustements seront probablement nécessaires.
