import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { rattacherMission } from "@/lib/projet/service";

// LOT 6 (28/10/2026) — rattache une mission existante du même client à un
// projet dont l'engagement est confirmé (création de mission inchangée).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/projets/[id]/missions");
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.missionId !== "string") return NextResponse.json({ error: "missionId requis." }, { status: 400 });
  const resultat = await rattacherMission(session.email, params.id, body.missionId);
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
