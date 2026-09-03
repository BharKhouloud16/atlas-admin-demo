# Préparer les modèles de contrat

Les 5 fichiers de ce dossier sont **déjà prêts** : j'ai remplacé les champs
automatisables (nom du client, TJM, nom du profil, rémunération) par des
balises docxtemplater. Tout le reste (adresse, SIRET, dates de naissance,
numéro RCS...) reste entre `[crochets]`, à compléter à la main au moment
de la signature — ce sont des informations qu'aucune base de données ici
ne connaît encore.

## Balises actuellement utilisées

`{nom_client}` `{profil_nom}` `{tjm_vente}` `{montant_profil}` (salaire
CDI / TJM payé selon le profil)

## Balises disponibles mais pas encore placées dans un contrat

`{secteur_client}` `{contact_client}` `{email_client}` `{type_contrat}`
`{nb_jours}` `{tjm_cout}` `{date_generation}`

Le `{tjm_cout}` est une donnée interne confidentielle : ne l'insérez
**jamais** dans un contrat destiné au client final, uniquement dans vos
propres documents internes si besoin.

## Pour ajouter une balise supplémentaire

1. Ouvrez le `.docx` dans Word, repérez le `[crochet]` à remplacer.
2. Remplacez-le par `{la_balise}` correspondante (voir la liste ci-dessus,
   ou ajoutez-en une nouvelle dans `app/api/generate-contract/route.ts`
   côté `doc.render({...})`).
3. Enregistrez au même endroit, sous le même nom.

