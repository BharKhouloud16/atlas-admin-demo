import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { genererFacturePdf } from "@/lib/pdf-facture";
import { persisterDocumentClient } from "@/lib/client-documents";
import { obtenirFichier } from "@/lib/storage";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — V2.2-B : Billing Foundation — document PDF d'une Facture.
//
// Réutilise intégralement lib/pdf-facture.ts (jamais un second moteur PDF,
// voir mandat CEO V2.2-B section 5) et lib/storage.ts (Blob privé, jamais
// d'URL publique — même discipline que
// app/api/client/documents/[id]/fichier). Génère le PDF au premier appel
// (une fois la Facture au moins VALIDEE, dateEmission non nul) et le
// persiste comme Document lié — les appels suivants servent le même
// fichier déjà stocké, jamais une re-génération qui pourrait produire un
// second PDF divergent pour la même Facture (Facture.documentId est
// @unique).
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

  const persiste = await persisterDocumentClient({
    titre: `Facture ${facture.numeroFacture}`,
    type: "FACTURE",
    nomFichier: `${facture.numeroFacture}.pdf`,
    buffer: Buffer.from(pdfBytes),
    missionId: facture.missionId,
    clientId: facture.clientId,
  });
  if (persiste) {
    const document = await prisma.document.findFirst({
      where: { clientId: facture.clientId, missionId: facture.missionId, titre: `Facture ${facture.numeroFacture}` },
      orderBy: { createdAt: "desc" },
    });
    if (document) {
      await prisma.facture.update({ where: { id: facture.id }, data: { documentId: document.id } }).catch(() => {
        // Best-effort — voir le commentaire équivalent de lib/client-documents.ts :
        // un échec de liaison ne doit jamais bloquer la transmission du PDF déjà généré.
      });
    }
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
