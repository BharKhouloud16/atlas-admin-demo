import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { calculerSignauxIntegrite } from "@/lib/engineer-access/integrity";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Dossier complet d'une candidature (contrat §13) — ADMIN uniquement,
// jamais le candidat lui-même (voir app/api/ingenieur/candidature/route.ts
// pour sa propre vue, strictement plus restreinte). Lecture seule : aucune
// mutation ici (voir PATCH /api/comptes pour les décisions).
export async function GET(_req: Request, { params }: { params: { userId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    include: {
      profil: { include: { infosCv: true } },
      client: true,
      accessDecisions: { orderBy: { decidedAt: "desc" } },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const signauxIntegrite = await calculerSignauxIntegrite(user.id);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    emailVerifie: user.emailVerifie,
    actif: user.actif,
    valideLe: user.valideLe,
    profil: user.profil
      ? {
          id: user.profil.id,
          nom: user.profil.nom,
          prenom: user.profil.prenom,
          cvUrl: user.profil.cvUrl,
          cvNomFichier: user.profil.cvNomFichier,
          cvImporteLe: user.profil.cvImporteLe,
          cvValide: user.profil.cvValide,
          infosCv: user.profil.infosCv,
        }
      : null,
    client: user.client
      ? {
          id: user.client.id,
          nom: user.client.nom,
          contactReferent: user.client.contactReferent,
          telephone: user.client.telephone,
          identifiantEntreprise: user.client.identifiantEntreprise,
          formeJuridique: user.client.formeJuridique,
        }
      : null,
    accessIntegrity: signauxIntegrite,
    decisions: user.accessDecisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      raison: d.raison,
      decidedByEmail: d.decidedByEmail,
      decidedAt: d.decidedAt,
    })),
  });
}
