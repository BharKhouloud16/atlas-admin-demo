import { prisma } from "@/lib/prisma";
import { uploaderFichier } from "@/lib/storage";
import type { StatutDocument } from "@prisma/client";

// CLIENT COMPLETION PROGRAM — C6/C7 (16/09/2026).
//
// Persiste, en Document, un fichier déjà généré (contrat .docx, facture
// PDF) pour qu'il devienne visible côté Client (GET /api/client/documents,
// jusqu'ici jamais alimenté par aucun chemin de code — voir l'audit). Le
// stockage (Vercel Blob privé, lib/storage.ts) exige BLOB_READ_WRITE_TOKEN,
// une variable gérée par Vercel : ni configurée ni modifiable depuis cette
// session (règle CEO "aucune modification Vercel manuelle"). Échec
// résilient et volontaire : si le stockage n'est pas disponible, le
// document généré reste téléchargeable par son appelant d'origine (Admin)
// exactement comme avant — seule la persistance côté Client échoue,
// silencieusement, sans jamais bloquer la génération primaire.
export async function persisterDocumentClient(params: {
  titre: string;
  type: StatutDocument;
  nomFichier: string;
  buffer: Buffer;
  missionId: string;
  clientId: string;
}): Promise<boolean> {
  try {
    const { url } = await uploaderFichier(params.nomFichier, new Blob([new Uint8Array(params.buffer)]), "documents");
    await prisma.document.create({
      data: {
        titre: params.titre,
        type: params.type,
        fileUrl: url,
        missionId: params.missionId,
        clientId: params.clientId,
      },
    });
    return true;
  } catch {
    return false;
  }
}
