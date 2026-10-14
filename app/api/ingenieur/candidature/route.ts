import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Vue du candidat sur SA PROPRE candidature — jamais un paramètre d'id
// dans l'URL (contrat §7/§18 : "candidat A ne peut pas lire candidat B"
// doit être structurellement impossible, pas seulement vérifié) : l'unique
// source d'identité est la session, exactement comme
// GET /api/client/missions ou GET /api/ingenieur/cv/infos. Expose
// STRICTEMENT moins que le dossier Admin (jamais les signaux Access
// Integrity, jamais les données d'un autre candidat).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.email },
    include: {
      accessDecisions: { orderBy: { decidedAt: "desc" }, take: 1 },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const derniereDecision = user.accessDecisions[0] ?? null;

  return NextResponse.json({
    emailVerifie: user.emailVerifie,
    actif: user.actif,
    derniereDecision: derniereDecision
      ? { decision: derniereDecision.decision, raison: derniereDecision.raison, decidedAt: derniereDecision.decidedAt }
      : null,
  });
}
