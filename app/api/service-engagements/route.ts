import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { creerServiceEngagementSchema, premierMessageZod } from "@/lib/validation";

// PHASE 7 — Service OS Foundation (22/09/2026). Premier objet Service OS
// réel, validé par le Decision Record Phase 6B : un conteneur Client-scoped
// minimal, PARALLÈLE à Mission — jamais une fusion, jamais un generic
// Engagement (voir Decision B). Réservé Admin, même isolation que le reste
// des ressources Admin-only (ex. /api/missions) : aucun accès Ingénieur,
// aucun accès Client à cette route (le Client a son propre endpoint filtré,
// voir /api/client/service-engagements — même principe que
// /api/missions vs /api/client/missions).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/service-engagements",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "ServiceEngagement",
      detail: "Tentative de création de ServiceEngagement par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = creerServiceEngagementSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  const client = await prisma.client.findUnique({ where: { id: donnees.clientId }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  const engagement = await prisma.serviceEngagement.create({
    data: {
      clientId: donnees.clientId,
      titre: donnees.titre,
      description: donnees.description ?? null,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "serviceos.engagement.cree",
    cible: `serviceEngagement:${engagement.id}`,
    detail: `${engagement.titre} créé pour le client ${donnees.clientId}`,
  });

  return NextResponse.json(engagement, { status: 201 });
}

// Liste Admin — pas de recherche avancée, pas de dashboard analytique (hors
// scope Phase 7, voir mandat section 8) : juste la liste, la plus récente
// en premier, avec le nom du client pour l'affichage.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const engagements = await prisma.serviceEngagement.findMany({
    select: {
      id: true,
      titre: true,
      description: true,
      statut: true,
      createdAt: true,
      client: { select: { id: true, nom: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(engagements);
}
