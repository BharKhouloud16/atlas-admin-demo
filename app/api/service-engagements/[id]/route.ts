import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { modifierServiceEngagementSchema, premierMessageZod } from "@/lib/validation";

// PHASE 7 — Service OS Foundation. Détail Admin d'un ServiceEngagement,
// incluant ses Documents attachés (source + rapport) — même discipline
// select explicite que le reste du dépôt (jamais un include non filtré).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const engagement = await prisma.serviceEngagement.findUnique({
    where: { id },
    select: {
      id: true,
      titre: true,
      description: true,
      statut: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, nom: true } },
      documents: {
        select: { id: true, titre: true, type: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!engagement) {
    return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }

  return NextResponse.json(engagement);
}

// Mise à jour Admin — titre/description/statut uniquement (voir mandat
// section 8 : pas de workflow d'approbation, pas d'engine, juste ces
// champs). clientId n'est jamais modifiable après création (même
// discipline que Mission : un engagement ne change jamais de client).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id } = await params;
  const avant = await prisma.serviceEngagement.findUnique({ where: { id }, select: { id: true, titre: true, statut: true } });
  if (!avant) {
    return NextResponse.json({ error: "ServiceEngagement introuvable" }, { status: 404 });
  }

  const corps = await req.json();
  const analyse = modifierServiceEngagementSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  const apres = await prisma.serviceEngagement.update({
    where: { id },
    data: {
      titre: donnees.titre ?? undefined,
      description: donnees.description === undefined ? undefined : donnees.description,
      statut: donnees.statut ?? undefined,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "serviceos.engagement.modifie",
    cible: `serviceEngagement:${id}`,
    detail: `statut ${avant.statut} -> ${apres.statut}`,
  });

  return NextResponse.json(apres);
}
