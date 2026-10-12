import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { enregistrerDecisionAcces, RaisonRequiseError, UtilisateurIntrouvableError } from "@/lib/engineer-access/decision";

// Réservé à l'Admin — le middleware protège déjà /api/comptes, mais on
// revérifie le rôle ici (defense in depth, comme pour les autres routes).
async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const enAttente = await prisma.user.findMany({
    where: { actif: false },
    include: { profil: true, client: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(enAttente);
}

// Décision ADMIN sur une candidature — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Même route qu'avant ce lot, contrat étendu : `decision` remplace
// l'ancienne approbation implicite. "APPROUVER" (défaut si omis, pour ne
// jamais casser un appelant existant appelant {userId} seul) reproduit
// EXACTEMENT l'ancien comportement (actif:true, valideLe, email, journal
// "validation_compte"). "REFUSER"/"DEMANDER_INFORMATIONS" sont nouveaux :
// ils ne changent jamais `actif`, exigent une raison non vide, et
// journalisent sous un nom d'action distinct — voir
// lib/engineer-access/decision.ts pour la logique centralisée (jamais
// dupliquée ici).
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { userId } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  const decisionsValides = ["APPROUVER", "REFUSER", "DEMANDER_INFORMATIONS"];
  const decision = typeof body.decision === "string" && decisionsValides.includes(body.decision) ? body.decision : "APPROUVER";
  const raison = typeof body.raison === "string" ? body.raison : undefined;

  try {
    await enregistrerDecisionAcces({
      userId,
      decision,
      raison,
      decidedByEmail: session.email,
    });
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    if (erreur instanceof UtilisateurIntrouvableError) {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }
    if (erreur instanceof RaisonRequiseError) {
      return NextResponse.json({ error: "Une raison est requise pour refuser ou demander des informations." }, { status: 400 });
    }
    throw erreur;
  }
}
