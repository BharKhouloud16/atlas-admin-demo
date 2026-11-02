import { NextResponse } from "next/server";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import type { getSession } from "@/lib/auth";

type Session = Awaited<ReturnType<typeof getSession>>;

// Même lecture d'IP que lib/rate-limit.ts (adresseIp), pour un Request standard.
function ip(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "inconnue";
}

// REV (01/11/2026) — refus d'accès aux routes Admin des lots 2 à 6 et de la
// vue « Demandes clients » : même réponse qu'avant (403), et désormais
// JOURNALISÉ (rbac.acces_refuse) quand un utilisateur connecté non Admin
// tente l'accès — même discipline que /api/factures. Un visiteur anonyme
// n'est pas journalisé (bruit sans acteur), il est déjà bloqué par le
// middleware.
export async function refuserAccesAdmin(req: Request | null, session: Session, route: string) {
  if (session) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ATTENTION",
      contexteIp: req ? ip(req) : undefined,
      contexteRoute: route,
      acteurEmail: session.email,
      acteurRole: session.role,
      detail: "Accès à une route réservée à l'administrateur.",
    });
  }
  return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
}
