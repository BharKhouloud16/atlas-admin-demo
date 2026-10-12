import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { enregistrerEvenementSecurite } from "@/lib/security/events";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §6, §15, §17. Seuil de révélation d'identité : nom/prénom UNIQUEMENT,
// exclusivement après CandidateSelection(ACTIVE) — jamais email/téléphone/
// CV/TJM. IDOR : l'identité se résout via selectionId -> ShortlistEntree ->
// Profil, JAMAIS un profilId accepté en paramètre (même discipline que
// besoin/matcher). Audité via l'événement de sécurité générique existant
// "objet.consultation" (Design Contract §6 — pas de nouvelle entrée de
// vocabulaire fermé pour ce lot).
export async function GET(req: NextRequest, { params }: { params: { selectionId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const selection = await prisma.candidateSelection.findUnique({
    where: { id: params.selectionId },
    include: { shortlistEntree: { include: { profil: { select: { nom: true, prenom: true } } } } },
  });

  const demande =
    selection && (await prisma.demandeTalent.findFirst({ where: { id: selection.demandeTalentId, clientId: session.clientId }, select: { id: true } }));

  if (!selection || !demande) {
    return NextResponse.json({ error: "Sélection introuvable." }, { status: 404 });
  }

  await enregistrerEvenementSecurite({
    acteurEmail: session.email,
    acteurRole: "CLIENT",
    action: "objet.consultation",
    ressourceType: "CandidateSelection.profil",
    ressourceId: params.selectionId,
    contexteRoute: req.nextUrl.pathname,
    resultat: "SUCCES",
  });

  return NextResponse.json({
    nom: selection.shortlistEntree.profil.nom,
    prenom: selection.shortlistEntree.profil.prenom,
  });
}
