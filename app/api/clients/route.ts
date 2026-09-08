import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// Réservé à l'Admin (voir /admin/clients) — le middleware protège déjà
// /api/clients, mais on revérifie le rôle ici (defense in depth, comme pour
// les autres routes Admin).
//
// FIX B17 (08/09/2026) — GET prend désormais `req: NextRequest` pour
// pouvoir journaliser l'IP sur un refus RBAC. Le contrôle de rôle ci-dessous
// existait déjà avant B17 (voir commentaire ci-dessus) ; seule la
// journalisation est nouvelle — voir middleware.ts (FIX B17) : ce contrôle
// était jusqu'ici inatteignable pour CLIENT et INGENIEUR, bloqués en amont
// par le middleware avant même d'atteindre ce code, donc jamais journalisé.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/clients",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Client",
      detail: "Tentative d'accès à la liste des clients par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/clients",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Client",
      detail: "Tentative de création de client par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();

  if (!body.nom) {
    return NextResponse.json({ error: "Le nom du client est requis" }, { status: 400 });
  }

  const client = await prisma.client.create({
    data: {
      nom: body.nom,
      pays: body.pays ?? null,
      secteur: body.secteur ?? null,
      contactReferent: body.contactReferent ?? null,
      email: body.email ?? null,
      telephone: body.telephone ?? null,
      statutPreferere: body.statutPreferere ?? null,
      dateDebutPrevue: body.dateDebutPrevue ? new Date(body.dateDebutPrevue) : null,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
