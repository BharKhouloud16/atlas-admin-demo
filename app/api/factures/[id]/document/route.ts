import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { genererFacturePdf } from "@/lib/pdf-facture";
import { uploaderFichier, obtenirFichier, supprimerFichier } from "@/lib/storage";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — V2.2-B/V2.2-C : Billing Foundation — document PDF d'une
// Facture.
//
// Réutilise intégralement lib/pdf-facture.ts (jamais un second moteur PDF)
// et lib/storage.ts (Blob privé, jamais d'URL publique — même discipline
// que app/api/client/documents/[id]/fichier). Génère le PDF au premier
// appel (une fois la Facture au moins VALIDEE, dateEmission non nul) et le
// persiste comme Document lié — les appels suivants servent le même
// fichier déjà stocké, jamais une re-génération qui pourrait produire un
// second PDF divergent pour la même Facture (Facture.documentId est
// @unique).
//
// FIX V2.2-C (mandat CEO section 21, "deux générations documentaires
// simultanées") — la persistance du Document est créée directement ici
// (plutôt que via lib/client-documents.ts persisterDocumentClient, qui ne
// renvoie pas l'id créé) et la liaison Facture.documentId se fait par une
// écriture conditionnelle (`updateMany` avec `documentId: null` en clause
// WHERE) : deux requêtes concurrentes qui génèrent chacune un PDF ne
// peuvent jamais toutes les deux gagner la liaison — la perdante supprime
// son Document/blob désormais inutile (best-effort) et sert le document du
// gagnant. Avant ce correctif, un `findFirst` post-création pouvait
// ambigument récupérer le Document d'UNE AUTRE requête concurrente, et les
// deux `update` sur Facture.documentId n'étaient protégés par aucune
// garde — la dernière écriture gagnait silencieusement, laissant l'autre
// Document orphelin.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (session.role === "INGENIEUR") return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const { id } = await params;
  const facture = await prisma.facture.findUnique({
    where: { id },
    include: { mission: { include: { client: true, profil: true } }, feuilleDeTemps: true, document: true },
  });
  if (!facture) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

  if (session.role === "CLIENT") {
    if (!session.clientId || facture.clientId !== session.clientId || !facture.dateEnvoi) {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/factures/[id]/document",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "Facture",
        ressourceId: id,
        detail: "Tentative de téléchargement du PDF d'une facture n'appartenant pas au client courant, ou non encore envoyée.",
      });
      return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
    }
  }

  if (!facture.dateEmission) {
    return NextResponse.json({ error: "Cette facture n'est pas encore validée — document non disponible." }, { status: 409 });
  }

  // Document déjà généré et persisté — on le sert tel quel, jamais une
  // seconde génération pour la même Facture.
  if (facture.document) {
    const fichier = await obtenirFichier(facture.document.fileUrl).catch(() => null);
    if (fichier) {
      return new NextResponse(fichier.stream, {
        headers: {
          "Content-Type": fichier.contentType,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-cache",
          "Content-Disposition": `inline; filename="${facture.numeroFacture}.pdf"`,
        },
      });
    }
    // Stockage indisponible (ex. BLOB_READ_WRITE_TOKEN non configuré, voir
    // lib/storage.ts) — jamais une 500 non gérée, comportement identique à
    // /api/client/documents/[id]/fichier.
  }

  const nomIngenieur = `${facture.mission.profil.prenom ?? ""} ${facture.mission.profil.nom}`.trim();
  const pdfBytes = await genererFacturePdf({
    numero: facture.numeroFacture,
    dateEmission: facture.dateEmission,
    mois: facture.feuilleDeTemps.mois,
    clientNom: facture.mission.client.nom,
    clientAdresse: facture.mission.client.pays,
    missionRepere: facture.mission.repere,
    ingenieurNom: nomIngenieur,
    joursTravailles: facture.feuilleDeTemps.joursTravailles,
    heuresSupplementaires: facture.feuilleDeTemps.heuresSupplementaires,
    tjmVente: facture.mission.tjmVente,
    deviseTjm: facture.devise,
  });

  try {
    const { url } = await uploaderFichier(`${facture.numeroFacture}.pdf`, new Blob([new Uint8Array(pdfBytes)]), "documents");
    const document = await prisma.document.create({
      data: { titre: `Facture ${facture.numeroFacture}`, type: "FACTURE", fileUrl: url, missionId: facture.missionId, clientId: facture.clientId },
    });

    // Écriture conditionnelle — voir le commentaire d'en-tête. `count === 0`
    // signifie qu'une autre requête a lié un Document entre notre lecture
    // initiale de `facture` et cet instant : la nôtre a perdu la course.
    const liaison = await prisma.facture.updateMany({ where: { id: facture.id, documentId: null }, data: { documentId: document.id } });

    if (liaison.count === 0) {
      await prisma.document.delete({ where: { id: document.id } }).catch(() => {
        // Best-effort — un Document orphelin non nettoyé n'est jamais lié
        // à une Facture (aucune fuite fonctionnelle), seulement un déchet.
      });
      await supprimerFichier(url);

      const factureGagnante = await prisma.facture.findUnique({ where: { id: facture.id }, include: { document: true } });
      const fichierGagnant = factureGagnante?.document ? await obtenirFichier(factureGagnante.document.fileUrl).catch(() => null) : null;
      if (fichierGagnant) {
        return new NextResponse(fichierGagnant.stream, {
          headers: {
            "Content-Type": fichierGagnant.contentType,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-cache",
            "Content-Disposition": `inline; filename="${facture.numeroFacture}.pdf"`,
          },
        });
      }
      // Le Document gagnant est introuvable (stockage indisponible entre
      // temps) — on sert malgré tout le PDF déjà généré ici plutôt qu'une
      // erreur, exactement comme le cas "stockage indisponible" ci-dessus.
    }
  } catch {
    // Stockage indisponible (BLOB_READ_WRITE_TOKEN absent, voir
    // lib/storage.ts) — jamais une 500 : le PDF généré reste transmis,
    // seule sa persistance échoue, silencieusement, comme avant ce correctif.
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${facture.numeroFacture}.pdf"`,
    },
  });
}
