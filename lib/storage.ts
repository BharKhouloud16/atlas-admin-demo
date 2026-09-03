// Stockage des fichiers (CV des ingénieurs, documents clients...) via Vercel
// Blob. Nécessite que le projet Vercel ait un Blob store connecté (Storage ->
// Create Database -> Blob -> Connect to Project) : cela crée automatiquement
// la variable d'environnement BLOB_READ_WRITE_TOKEN, sans jamais avoir à la
// saisir manuellement.
//
// Si BLOB_READ_WRITE_TOKEN n'est pas configurée, uploaderFichier() lève une
// erreur explicite plutôt que d'échouer silencieusement.

import { put, del } from "@vercel/blob";

export async function uploaderFichier(
  nomFichier: string,
  fichier: File | Blob,
  dossier: string = "cv"
): Promise<{ url: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Le stockage de fichiers n'est pas configuré (BLOB_READ_WRITE_TOKEN manquant). " +
        "Connectez un Blob store depuis le tableau de bord Vercel : Storage -> Create Database -> Blob -> Connect to Project."
    );
  }

  const chemin = `${dossier}/${Date.now()}-${nomFichier}`;
  const resultat = await put(chemin, fichier, {
    access: "public",
    addRandomSuffix: true,
  });

  return { url: resultat.url };
}

export async function supprimerFichier(url: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch {
    // best-effort : on ne bloque jamais une opération métier sur un échec de suppression
  }
}
