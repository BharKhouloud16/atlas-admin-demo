// Stockage des fichiers (CV des ingénieurs, documents clients...) via Vercel
// Blob, en mode PRIVÉ : les fichiers ne sont jamais accessibles par une URL
// publique, seulement via getFichier() ci-dessous, qui doit être appelé
// depuis une route qui vérifie elle-même les droits de l'utilisateur (voir
// app/api/ingenieur/cv/fichier/route.ts).
//
// Nécessite que le projet Vercel ait un Blob store PRIVÉ connecté (Storage ->
// Create Database -> Blob -> Access: Private -> Connect to Project) : cela
// crée automatiquement la variable d'environnement BLOB_READ_WRITE_TOKEN,
// sans jamais avoir à la saisir manuellement.
//
// Si BLOB_READ_WRITE_TOKEN n'est pas configurée, uploaderFichier() lève une
// erreur explicite plutôt que d'échouer silencieusement.

import { put, del, get } from "@vercel/blob";

export async function uploaderFichier(
  nomFichier: string,
  fichier: File | Blob,
  dossier: string = "cv"
): Promise<{ url: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Le stockage de fichiers n'est pas configuré (BLOB_READ_WRITE_TOKEN manquant). " +
        "Connectez un Blob store privé depuis le tableau de bord Vercel : Storage -> Create Database -> Blob -> Access: Private -> Connect to Project."
    );
  }

  const chemin = `${dossier}/${Date.now()}-${nomFichier}`;
  const resultat = await put(chemin, fichier, {
    access: "private",
    addRandomSuffix: true,
  });

  return { url: resultat.url };
}

// Récupère un fichier privé (stream + type MIME) pour le servir depuis une
// route authentifiée. Ne jamais exposer directement l'URL renvoyée par
// uploaderFichier() : elle n'est lisible qu'avec ce token côté serveur.
export async function obtenirFichier(
  url: string
): Promise<{ stream: ReadableStream; contentType: string } | null> {
  const resultat = await get(url, { access: "private" });
  if (!resultat || resultat.statusCode !== 200 || !resultat.stream) {
    return null;
  }
  return { stream: resultat.stream, contentType: resultat.blob.contentType };
}

export async function supprimerFichier(url: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch {
    // best-effort : on ne bloque jamais une opération métier sur un échec de suppression
  }
}
