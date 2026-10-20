# Configuration de l'envoi d'emails (Vercel Preview et Production)

Sans fournisseur d'email configuré **et vérifié**, l'inscription, la vérification
d'adresse et le mot de passe oublié **ne fonctionnent pas** sur Vercel : ces
routes répondent `503` (message identique pour toute adresse, aucun compte
créé, aucun lien divulgué). C'est voulu : avant le correctif, le lien secret
était renvoyé dans la réponse HTTP ou écrit dans les journaux.

## Variables à définir (propriétaire du projet Vercel, action manuelle)

| Variable | Preview | Production | Remarques |
|---|---|---|---|
| `RESEND_API_KEY` | oui (Sensitive) | oui (Sensitive) | Clé « Sending access » limitée au domaine d'envoi. Idéalement une clé distincte par environnement. Ne jamais la coller dans un chat, un ticket ou un fichier du dépôt. |
| `EMAIL_FROM` | oui | oui | Ex. `Atlas Quality Partners <contact@atlas-qa.com>`. Le domaine de l'adresse doit être **vérifié** dans Resend. Défaut du code : `contact@atlas-qa.com`. |
| `EMAIL_APP_BASE_URL` | facultatif | recommandé | Origine HTTPS seule (sans chemin), ex. `https://atlas-admin-demo.vercel.app`. À défaut : Production → `https://$VERCEL_PROJECT_PRODUCTION_URL`, Preview → `https://$VERCEL_BRANCH_URL` (ou `$VERCEL_URL`). Ne jamais mettre l'URL de Production dans l'environnement Preview. |
| `ATLAS_LIENS_DEMO` | **ne pas définir** | **ne pas définir** | Ignorée sur Vercel de toute façon (CI uniquement). |
| `SEED_TOKEN` | à retirer (voir ci-dessous) | **à retirer** | `/api/dev-seed` répond 404 en Production ; le jeton n'y sert plus. |

Les variables système Vercel (`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`,
`VERCEL_PROJECT_PRODUCTION_URL`) doivent rester exposées (« Automatically expose
System Environment Variables », actuellement activé).

## Domaine d'envoi (Resend)

1. Ajouter le domaine de `EMAIL_FROM` (ex. `atlas-qa.com`) dans Resend.
2. Publier dans le DNS du domaine les enregistrements fournis par Resend (SPF,
   DKIM ; DMARC recommandé), puis attendre le statut « Verified ».
3. Tant que le domaine n'est pas vérifié, les envois échouent : l'application
   journalise `[email:erreur]` (adresse masquée, sans contenu) et la réponse
   publique reste générique — la personne ne reçoit rien.

## Preview : point d'attention

Si la protection de déploiement Vercel est active sur Preview, un lien reçu par
email ne s'ouvre que pour une personne connectée à l'équipe Vercel. Tester
avec un compte membre, ou prévoir une exception de protection.

## Tests à réaliser après configuration (avec une boîte mail de test vous appartenant)

1. Preview — inscription avec une adresse neuve : réponse 201 « Demande
   enregistrée », email reçu, lien `https://<branche>.vercel.app/verifier-email?token=…`
   (jamais le domaine de Production), confirmation OK, second clic refusé.
2. Preview — inscription avec la même adresse : même réponse 201, email
   « Tentative d'inscription » reçu, aucun second compte.
3. Preview — renvoi de vérification : email reçu ; un second renvoi dans les
   2 minutes ne renvoie rien (réponse identique).
4. Preview — mot de passe oublié : email reçu, lien valable 1 h, usage
   unique ; adresse inconnue → même réponse, aucun email.
5. Journaux Vercel : aucune adresse complète, aucun jeton, aucun lien.
6. Recommencer 1 à 5 en Production après déploiement autorisé.
