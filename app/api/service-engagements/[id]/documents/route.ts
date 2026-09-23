import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { uploaderFichier } from "@/lib/storage";

// PHASE 7 — Service OS Foundation. Upload Admin d'un Document (source ou
// rapport) rattaché à un ServiceEngagement — même mécanisme d'upload que
// app/api/ingenieur/cv/route.ts (formData + uploaderFichier), aucun
// nouveau storage namespace (voir mandat section 10). clientId est
// TOUJOURS dérivé du ServiceEngagement côté serveur, jamais du corps de la
// requête — même discipline que missionId sur Mission (voir
// app/api/missions/route.ts).
//
// `type` limité à RAPPORT_AUDIT/AUTRE : CONTRAT et FACTURE restent réservés
// à leurs propres flux existants (generate-contract, facturation) — cette
// route ne doit jamais pouvoir produire un Document visuellement confondu
// avec un contrat ou une facture générés.
const TYPES_ACCEPTES = ["RAPPORT_AUDIT", "AUTRE"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const engagement = await prisma.serviceEngagement.findUnique({ where: { id }, select: { id: true, clientId: true } });
  if (!engagement) {
    return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }

  const form = await req.formData();
  const fichier = form.get("fichier");
  if (!fichier || !(fichier instanceof File)) {
    return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
  }
  const titre = typeof form.get("titre") === "string" ? (form.get("titre") as string).trim() : "";
  if (!titre) {
    return NextResponse.json({ error: "Titre requis" }, { status: 400 });
  }
  const typeDemande = form.get("type");
  const type = (TYPES_ACCEPTES as readonly string[]).includes(typeDemande as string) ? (typeDemande as (typeof TYPES_ACCEPTES)[number]) : "AUTRE";

  const octets = await fichier.arrayBuffer();
  let url: string;
  try {
    const uploade = await uploaderFichier(fichier.name, new Blob([octets], { type: fichier.type }), "service-engagements");
    url = uploade.url;
  } catch (e: any) {
    // PHASE 14B — ne jamais renvoyer e.message au client (peut contenir des
    // détails d'infrastructure, ex. "BLOB_READ_WRITE_TOKEN manquant", voir
    // lib/storage.ts) — message générique côté client, détail en log serveur.
    console.error(`Échec de l'upload du document (ServiceEngagement ${engagement.id}) :`, e.message ?? e);
    return NextResponse.json({ error: "Une erreur est survenue lors de l'envoi du fichier." }, { status: 500 });
  }

  // serviceEngagementId seul, jamais missionId (contrainte CHECK en base,
  // voir migration) — un Document Service OS n'est jamais aussi un
  // Document Mission.
  const document = await prisma.document.create({
    data: {
      titre,
      type,
      fileUrl: url,
      clientId: engagement.clientId,
      serviceEngagementId: engagement.id,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "serviceos.document.attache",
    cible: `serviceEngagement:${engagement.id}:document:${document.id}`,
    detail: `${document.titre} (${document.type}) attaché`,
  });

  return NextResponse.json({ id: document.id, titre: document.titre, type: document.type, createdAt: document.createdAt }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const engagement = await prisma.serviceEngagement.findUnique({ where: { id }, select: { id: true } });
  if (!engagement) {
    return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }

  const documents = await prisma.document.findMany({
    where: { serviceEngagementId: id },
    select: { id: true, titre: true, type: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(documents);
}
