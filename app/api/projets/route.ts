import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { listerProjetsAdmin } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — vue ADMIN des projets complets.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(null, session, "/api/projets");
  }
  return NextResponse.json({ projets: await listerProjetsAdmin() });
}
