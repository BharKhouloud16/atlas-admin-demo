import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { genererOuRecupererCapacites, BesoinIntrouvableError, VersionNonCouranteError } from "@/lib/capability/service";

// COMPANY ATLAS — A8 : Capability Engine V1 — API Client.
//
// GET déclenche (ou récupère, si déjà à jour — idempotent) la dérivation
// des CapabilityRequirement pour un ClientNeed. Même patron exact que
// GET /api/client/besoins/[id]/solutions (lib/client-solution/generation.ts) :
// clientId toujours dérivé de la session, jamais du corps/params ; un
// besoin d'un autre client renvoie 404, jamais une fuite d'existence.
// Aucune route POST : la dérivation pure suffit (mandat A8 §16).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  try {
    const resultat = await genererOuRecupererCapacites(params.id, session.clientId);
    return NextResponse.json(resultat);
  } catch (erreur) {
    if (erreur instanceof BesoinIntrouvableError) {
      return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
    }
    if (erreur instanceof VersionNonCouranteError) {
      return NextResponse.json(
        { error: "Cette version n'est plus la version courante — elle a été remplacée par une version plus récente." },
        { status: 409 }
      );
    }
    throw erreur;
  }
}
