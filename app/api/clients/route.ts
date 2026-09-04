import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Réservé à l'Admin (voir /admin/clients) — le middleware protège déjà
// /api/clients, mais on revérifie le rôle ici (defense in depth, comme pour
// les autres routes Admin).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
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
