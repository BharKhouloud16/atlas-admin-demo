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
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { simulationsCiActives, PREFIXE_URL_SIMULATION } from "@/lib/simulation-ci";

// Stockage SIMULÉ, réservé à la CI (voir lib/simulation-ci.ts) et limité au
// dossier « cv » : les autres dossiers (pièces jointes, factures) gardent en
// CI le comportement réel « stockage indisponible -> 503 », que leurs tests
// vérifient. Fichiers écrits dans un répertoire temporaire du runner.
const DOSSIERS_SIMULES = new Set(["cv"]);
const RACINE_SIMULATION = path.join(os.tmpdir(), "atlas-simulation-ci");

function cheminSimule(url: string): string | null {
  const relatif = url.slice(PREFIXE_URL_SIMULATION.length);
  if (!/^[a-z-]+\/[0-9a-f-]{36}$/.test(relatif)) return null;
  return path.join(RACINE_SIMULATION, relatif);
}

export async function uploaderFichier(
  nomFichier: string,
  fichier: File | Blob,
  dossier: string = "cv"
): Promise<{ url: string }> {
  if (simulationsCiActives() && DOSSIERS_SIMULES.has(dossier)) {
    const url = `${PREFIXE_URL_SIMULATION}${dossier}/${randomUUID()}`;
    const chemin = cheminSimule(url)!;
    await fs.mkdir(path.dirname(chemin), { recursive: true });
    await fs.writeFile(chemin, Buffer.from(await fichier.arrayBuffer()));
    await fs.writeFile(`${chemin}.type`, fichier.type || "application/octet-stream");
    return { url };
  }

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
  if (url.startsWith(PREFIXE_URL_SIMULATION)) {
    // Un fichier simulé n'est jamais servi hors simulation active.
    const chemin = simulationsCiActives() ? cheminSimule(url) : null;
    if (!chemin) return null;
    const octets = await fs.readFile(chemin).catch(() => null);
    if (!octets) return null;
    const contentType = await fs.readFile(`${chemin}.type`, "utf8").catch(() => "application/octet-stream");
    return { stream: new Blob([new Uint8Array(octets)]).stream(), contentType };
  }
  const resultat = await get(url, { access: "private" });
  if (!resultat || resultat.statusCode !== 200 || !resultat.stream) {
    return null;
  }
  return { stream: resultat.stream, contentType: resultat.blob.contentType };
}

export async function supprimerFichier(url: string): Promise<void> {
  if (url.startsWith(PREFIXE_URL_SIMULATION)) {
    const chemin = simulationsCiActives() ? cheminSimule(url) : null;
    if (chemin) await fs.rm(chemin, { force: true }).catch(() => undefined);
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch {
    // best-effort : on ne bloque jamais une opération métier sur un échec de suppression
  }
}
