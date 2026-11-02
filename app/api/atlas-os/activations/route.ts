import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";

// LOT 5 (28/10/2026) — vue ADMIN des demandes d'activation ATLAS OS.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(null, session, "/api/atlas-os/activations");
  }
  const lignes = await prisma.activationAtlasOs.findMany({
    orderBy: [{ statut: "asc" }, { demandeLe: "desc" }],
    include: { client: { select: { nom: true, pays: true } } },
  });
  return NextResponse.json({ activations: lignes });
}
