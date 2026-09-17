import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { adapterFactureClient } from "@/lib/billing/adapter";

// COMPANY ATLAS — V2.2-B : Billing Foundation — détail d'une Facture.
//
// Même discipline anti-IDOR/BOLA que /api/client/documents/[id]/fichier
// (V1) et /api/client/besoins/[id] (LOT 2) : ownership revérifiée en base,
// 404 (jamais une fuite d'existence) si la Facture n'appartient pas au
// Client courant. Un Client ne voit jamais une Facture non encore envoyée
// (dateEnvoi null) même s'il en connaît l'id — même règle que la liste
// (voir app/api/factures/route.ts).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const facture = await prisma.facture.findUnique({ where: { id }, include: { paiements: true } });
  if (!facture) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

  if (session.role === "ADMIN") {
    return NextResponse.json({ facture });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId || facture.clientId !== session.clientId || !facture.dateEnvoi) {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/factures/[id]",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "Facture",
        ressourceId: id,
        detail: "Tentative d'accès à une facture n'appartenant pas au client courant, ou non encore envoyée.",
      });
      return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
    }
    return NextResponse.json({ facture: adapterFactureClient(facture) });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}
