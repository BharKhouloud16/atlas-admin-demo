import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.nom) {
    return NextResponse.json({ error: "Le nom du client est requis" }, { status: 400 });
  }

  const client = await prisma.client.create({
    data: {
      nom: body.nom,
      secteur: body.secteur ?? null,
      contactReferent: body.contactReferent ?? null,
      email: body.email ?? null,
      statutPreferere: body.statutPreferere ?? null,
      dateDebutPrevue: body.dateDebutPrevue ? new Date(body.dateDebutPrevue) : null,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
