import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { changerStatutAdmin, detailProjetAdmin } from "@/lib/projet/service";
import type { StatutProjetValeur } from "@/lib/projet/regles";

// LOT 6 (28/10/2026) — détail ADMIN d'un projet et transitions manuelles
// (qualifier, confirmer l'engagement, démarrer, terminer, abandonner).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(_req, session, "/api/projets/[id]");
  }
  const projet = await detailProjetAdmin(params.id);
  if (!projet) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  return NextResponse.json({ projet });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/projets/[id]");
  }
  const body = await req.json().catch(() => null);
  const statut = typeof body?.statut === "string" ? (body.statut as StatutProjetValeur) : null;
  if (!statut) return NextResponse.json({ error: "statut requis." }, { status: 400 });
  const motif = typeof body?.motif === "string" ? body.motif.trim().slice(0, 1000) || null : null;
  const resultat = await changerStatutAdmin(session.email, params.id, statut, motif);
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur, manquants: resultat.manquants }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
