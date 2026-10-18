import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { listerCapacitesExistantes } from "@/lib/capability/service";

// COMPANY ATLAS — A8 : Capability Engine V1 — vue Admin.
//
// Réservé ADMIN, même patron que GET /api/talent/besoins/[id]/solutions
// (pas d'isolation clientId — vue transverse). Lecture seule : ne
// déclenche jamais de dérivation (réservé au parcours Client, seul
// déclencheur légitime) — renvoie uniquement les CapabilityRequirement
// déjà persistés.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const need = await prisma.clientNeed.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!need) {
    return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });
  }

  const capabilities = await listerCapacitesExistantes(params.id);
  return NextResponse.json({ capabilities });
}
