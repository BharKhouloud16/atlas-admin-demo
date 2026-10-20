# ATLAS V1 — procédure de diagnostic du compte ADMIN en Production

## Objectif
Vérifier l'état d'un compte existant sans modifier le compte ni les données.

## Garde-fous
- Cette procédure est strictement en lecture seule.
- Ne jamais exécuter `prisma/create-admin.ts` pour « vérifier » un compte : ce script peut remplacer le mot de passe, promouvoir le rôle et réactiver un compte.
- Ne jamais publier `DATABASE_URL`, `passwordHash`, secret TOTP, codes de secours ou mots de passe dans les logs, tickets ou conversations.
- Ne pas deviner le libellé de la base Production. Le diagnostic runtime `GET /api/sante` doit d'abord confirmer le libellé réel et le commit du déploiement Production.
- Avant toute opération d'écriture ultérieure : confirmer la base exacte, la séparation Preview/Production et l'existence d'une sauvegarde récente restaurable. Cette étape exige une autorisation explicite distincte.

## Préconditions d'exécution
1. Un opérateur autorisé exécute le script dans un environnement contrôlé où la variable `DATABASE_URL` provient du déploiement Production vérifié, sans la copier dans un terminal partagé.
2. L'opérateur confirme indépendamment le libellé attendu renvoyé par le diagnostic Production `/api/sante`.
3. Exécuter le script avec ce libellé exact, par exemple :

```sh
ATLAS_EXPECTED_DB_LABEL=<libellé-exact-confirmé> npx tsx prisma/audit-admin.ts contact@atlas-qa.com
```

Le libellé d'exemple ne doit pas être présumé : remplacer le placeholder uniquement après vérification. Le script refuse d'interroger la base si la cible ne correspond pas exactement.

## Résultat attendu
Le script affiche uniquement : existence du compte, rôle, actif, email vérifié, nombre d'échecs de connexion, date de verrouillage, état TOTP (sans secret), nombre de codes de secours disponibles et date de première connexion. Il n'affiche aucun hash ou secret et n'écrit aucune donnée métier.

## Suite après diagnostic
- Si le compte n'existe pas : arrêter et décider d'une procédure de création séparée, contrôlée et approuvée.
- Si le rôle, l'état actif ou l'email vérifié sont incorrects : préparer une correction minimale après confirmation de l'identité et des preuves nécessaires. Ne pas corriger automatiquement.
- Si le compte est verrouillé : attendre la fin du verrouillage ou définir une procédure de déverrouillage autorisée ; ne pas réinitialiser arbitrairement le compteur.
- Si TOTP est actif : la connexion exige un code TOTP ou un code de secours. Ne pas désactiver le second facteur pour contourner un échec de connexion.
- Après toute correction autorisée, vérifier la connexion réelle, la session et les droits ADMIN, puis vérifier que CLIENT et INGENIEUR n'accèdent pas aux fonctions réservées à l'administration.

Aucune modification de Production, migration, fusion ou déploiement n'est autorisé par cette procédure.
