import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listerAgentsIdentity } from "@/lib/agents/identity";

// COMPANY ATLAS — B19 (08/09/2026) : lecture SEULE du registre Agent
// Identity (lib/agents/identity.ts). Réservé ADMIN, même discipline que
// /api/security/evenements, /api/security/runtime et /api/security/rapports
// (B16-B18) : cette route ne figure PAS dans middleware.ts (aucune route
// sous /api/security ne l'a jamais été), la protection est assurée ICI par
// getSession()+role — audit B19 confirmé, aucune modification de
// middleware.ts n'était donc nécessaire.
//
// VOLONTAIREMENT AUCUNE ROUTE POST/PATCH/DELETE : les 4 identités
// officielles sont seedées une fois pour toutes par la migration Prisma
// (voir prisma/migrations/.../migration.sql) — il n'existe structurellement
// aucun moyen, via cette API, de créer un 5e agent ou de modifier une
// identité existante (directive B19, Phase 4 : "Pas de POST /agents
// permettant à n'importe qui de créer une identité arbitraire").

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const agents = await listerAgentsIdentity();
    return NextResponse.json({ agents });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture du registre Agent Identity." }, { status: 500 });
  }
}
