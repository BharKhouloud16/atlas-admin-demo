import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { listerDemandesClients } from "@/lib/demandes-clients/service";

// REV (01/11/2026) — liste Admin des demandes Clients (voir
// lib/demandes-clients/service.ts). Réservée à l'Admin.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/admin/demandes-clients");
  }
  const statut = req.nextUrl.searchParams.get("statut") === "CLOTUREES" ? "CLOTUREES" : "OUVERTES";
  return NextResponse.json({ demandes: await listerDemandesClients({ statut }) }, { headers: { "Cache-Control": "no-store" } });
}
