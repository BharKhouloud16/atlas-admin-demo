import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { autoriserProposition } from "@/lib/strategic/propositions";

// COMPANY ATLAS — B21 (13/09/2026) : SEULE route capable de faire passer
// une StrategicActionProposal de PROPOSEE à AUTORISEE (voir
// lib/strategic/propositions.ts, autoriserProposition). Réservé ADMIN.
//
// RÈGLE ABSOLUE (directive B21, "ne jamais s'auto-autoriser") :
// `autorisateurEmail` n'est JAMAIS lu depuis le corps de la requête — il
// est TOUJOURS dérivé de `session.email` (la session ADMIN authentifiée
// qui appelle cette route). Un agent n'a pas de session (limite héritée de
// B19/B20 : aucune authentification agent réelle n'existe encore dans
// COMPANY ATLAS) et ne peut donc structurellement jamais appeler cette
// route ni apparaître comme autorisateur — seul un humain ADMIN le peut.
// Ceci N'EST PAS un Authorization Engine complet (hors périmètre B21) :
// aucune vérification de scope/risque/tier n'est effectuée au-delà de la
// présence de scope+duree (voir lib/strategic/propositions.ts) — un futur
// lot pourra enrichir cette route sans changer son principe fondateur.

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const scope = body?.scope;
    const duree = body?.duree;

    if (typeof scope !== "string" || scope.trim().length === 0) {
      return NextResponse.json({ error: "scope requis — une autorisation doit toujours être scoped." }, { status: 400 });
    }
    if (typeof duree !== "string" || duree.trim().length === 0) {
      return NextResponse.json({ error: "duree requise — une autorisation doit toujours être scoped." }, { status: 400 });
    }

    const resultat = await autoriserProposition({
      proposalId: params.id,
      // Dérivé de la session serveur — jamais du corps de la requête (voir
      // en-tête). C'est le mécanisme concret qui rend l'auto-autorisation
      // structurellement impossible : seul un humain ADMIN authentifié
      // peut atteindre cette ligne.
      autorisateurEmail: session.email,
      scope,
      duree,
      budget: typeof body?.budget === "string" ? body.budget : undefined,
      limites: typeof body?.limites === "string" ? body.limites : undefined,
    });

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 400 });
    }

    return NextResponse.json({ id: resultat.id, statut: "AUTORISEE", autorisateurEmail: session.email });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de l'autorisation." }, { status: 500 });
  }
}
