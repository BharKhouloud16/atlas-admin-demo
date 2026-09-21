import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { validerContenuMessage } from "@/lib/client-messages";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Pendant ADMIN de GET/POST /api/client/messages — même table Message,
// jamais une seconde source de vérité. Réservé ADMIN (jamais INGENIEUR,
// même si le middleware laisse passer /api/clients/* pour ce rôle via
// SHARED_PREFIXES — la route reste seule responsable de l'autorisation
// exacte, même discipline de défense en profondeur que /api/clients,
// /api/generate-contract). clientId vient exclusivement du paramètre
// d'URL (id de Client réellement existant, jamais du corps de la
// requête) — l'Admin agit toujours au nom d'un client explicitement
// identifié, jamais implicite.

async function refuserAcces(req: NextRequest, contexteRoute: string, session: Awaited<ReturnType<typeof getSession>>) {
  await enregistrerEvenementSecurite({
    correlationId: nouveauCorrelationId(),
    action: "rbac.acces_refuse",
    resultat: "REFUSE",
    severite: "ALERTE",
    contexteIp: adresseIp(req),
    contexteRoute,
    acteurEmail: session?.email ?? null,
    acteurRole: session?.role ?? null,
    ressourceType: "Message",
    detail: "Tentative d'accès à la messagerie d'un client par un rôle non-Admin.",
  });
  return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session || session.role !== "ADMIN") {
    return refuserAcces(req, `/api/clients/${id}/messages`, session);
  }

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }

  // V2.4 — Pièces jointes (Lot 1/2) : métadonnées uniquement, jamais
  // fileUrl (voir lib/storage.ts), jamais les pièces supprimées
  // logiquement (supprimeLe non null).
  const messages = await prisma.message.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "asc" },
    include: {
      pieceJointes: {
        where: { supprimeLe: null },
        select: { id: true, nomFichier: true, mimeType: true, tailleOctets: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session || session.role !== "ADMIN") {
    return refuserAcces(req, `/api/clients/${id}/messages`, session);
  }

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const contenu = validerContenuMessage(body?.contenu);
  if (!contenu) {
    return NextResponse.json({ error: "Contenu requis (1 à 2000 caractères)." }, { status: 400 });
  }

  const message = await prisma.message.create({
    data: { clientId: id, auteurRole: "ADMIN", contenu },
  });

  return NextResponse.json({ message }, { status: 201 });
}
