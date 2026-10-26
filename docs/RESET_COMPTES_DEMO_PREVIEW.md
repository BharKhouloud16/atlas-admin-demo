# Réinitialisation des comptes de démonstration — Preview uniquement

Script : `scripts/reinitialiser-comptes-demo.ts` · logique et garde-fous : `lib/demo-reset.ts` · tests : `tests/unit/demo-reset.spec.ts`.

## Pourquoi

Sur `atlas-preview`, les comptes `admin-demo`, `client-demo` et `ingenieur-demo` existent, sont actifs, ont le bon rôle et un email confirmé, mais leur mot de passe n'est pas `Demo1234` (créés le 27/09, vraisemblablement par `/api/dev-seed` exécuté sur Vercel, qui génère un mot de passe aléatoire). La connexion renvoie donc « Identifiants invalides ».

## Ce que fait le script

| Étape | Détail |
|---|---|
| 1. Cible | Refuse si `VERCEL_ENV=production`, si `ATLAS_CONFIRMER_CIBLE` ≠ `gvehwiukssyeydmerqyd`, si la référence lue dans `DATABASE_URL` (hôte `db.<ref>.supabase.co` ou utilisateur `postgres.<ref>` du pooler) n'est pas exactement celle-ci, ou si l'empreinte calculée par `lib/db-target.ts` n'est pas `supabase-atlas-preview`. La base historique (Production) est donc refusée même avec la confirmation. |
| 2. Mots de passe | Lus uniquement dans `DEMO_RESET_MDP_ADMIN`, `DEMO_RESET_MDP_CLIENT`, `DEMO_RESET_MDP_INGENIEUR` ; 8 caractères minimum, sans espace en bord ; jamais affichés. |
| 3. Précontrôle (lecture seule) | Les 3 comptes existent une seule fois, rôle attendu, `actif=true`, `emailVerifie=true`, `desactive=false`, `totpActif=false`. Sinon : refus. |
| 4. Écriture (seulement avec `--appliquer`) | bcrypt coût 12 (identique à l'application), puis transaction `Serializable` : relecture et nouveau précontrôle, mise à jour de `passwordHash`, `echecsConnexion=0`, `verrouilleJusqua=null` sur chaque compte (filtre `id + email + rôle + actif`, exactement 1 ligne chacun), vérification `bcrypt.compare` avant validation. La moindre anomalie annule tout. |

Aucun autre utilisateur, aucun autre champ, aucun schéma ni migration n'est touché. `en-attente-demo@example.com` est exclu.

## Exécution (par la propriétaire, depuis son poste)

Prérequis : le dépôt sur la branche `v1/delivery`, `npm install` et `npx prisma generate` faits. Le script n'est jamais exécuté par la CI ni par Vercel.

1. Récupérer la chaîne de connexion **du projet `atlas-preview`** : Supabase → projet `atlas-preview` (vérifier `gvehwiukssyeydmerqyd` dans l'URL du tableau de bord) → **Connect** → chaîne *Session pooler* ou *Direct connection*. Ne pas la coller dans un chat.

2. Dans un terminal, **sans écrire les valeurs dans l'historique du shell** (bash/zsh) :

   ```bash
   read -rs DATABASE_URL && export DATABASE_URL
   read -rs DEMO_RESET_MDP_ADMIN && export DEMO_RESET_MDP_ADMIN
   read -rs DEMO_RESET_MDP_CLIENT && export DEMO_RESET_MDP_CLIENT
   read -rs DEMO_RESET_MDP_INGENIEUR && export DEMO_RESET_MDP_INGENIEUR
   export ATLAS_CONFIRMER_CIBLE=gvehwiukssyeydmerqyd
   ```

   PowerShell :

   ```powershell
   $env:DATABASE_URL = Read-Host -MaskInput
   $env:DEMO_RESET_MDP_ADMIN = Read-Host -MaskInput
   $env:DEMO_RESET_MDP_CLIENT = Read-Host -MaskInput
   $env:DEMO_RESET_MDP_INGENIEUR = Read-Host -MaskInput
   $env:ATLAS_CONFIRMER_CIBLE = "gvehwiukssyeydmerqyd"
   ```

3. Précontrôle seul (aucune écriture) :

   ```bash
   npx tsx scripts/reinitialiser-comptes-demo.ts
   ```

   Attendu : `Cible : projet Supabase Preview confirmé…`, `Précontrôle : 3 comptes trouvés…`, `Mode précontrôle seul : aucune écriture.` Tout `REFUS — …` arrête le processus sans rien écrire.

4. Application :

   ```bash
   npx tsx scripts/reinitialiser-comptes-demo.ts --appliquer
   ```

   Attendu : trois lignes `OK — <email> (<rôle>) : mot de passe réinitialisé…`.

5. Nettoyer la session : `unset DATABASE_URL DEMO_RESET_MDP_ADMIN DEMO_RESET_MDP_CLIENT DEMO_RESET_MDP_INGENIEUR ATLAS_CONFIRMER_CIBLE` (PowerShell : `Remove-Item Env:DATABASE_URL, Env:DEMO_RESET_MDP_*, Env:ATLAS_CONFIRMER_CIBLE`). Ranger les nouveaux mots de passe dans un gestionnaire de mots de passe.

## Vérification après exécution — une seule tentative par compte

Sur l'URL de déploiement Preview non bloquée (ex. `https://atlas-admin-demo-74u4z7t1k-bharkhouloud16.vercel.app/connexion`), une connexion par rôle, déconnexion entre chaque :

| Compte | Page d'arrivée attendue |
|---|---|
| `admin-demo@example.com` | `/admin` (tableau de bord) |
| `client-demo@example.com` | `/client` |
| `ingenieur-demo@example.com` | `/ingenieur/cv` (aucun CV importé) |

Contrôle en lecture seule dans le SQL Editor de `atlas-preview` :

```sql
SELECT email, "echecsConnexion", "verrouilleJusqua", "premiereConnexionLe"
FROM "User" WHERE email IN ('admin-demo@example.com','client-demo@example.com','ingenieur-demo@example.com');
```

Attendu après les trois connexions réussies : `echecsConnexion = 0`, `verrouilleJusqua = NULL`.

## Retour arrière

Les anciens mots de passe étant inconnus, il n'y a pas de retour à l'état antérieur utile ; en cas de besoin, relancer le script avec de nouvelles valeurs. Le script ne modifie que les trois champs listés.
