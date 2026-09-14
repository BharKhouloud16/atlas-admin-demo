import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { autoriserProposition } from "@/lib/strategic/propositions";

// COMPANY ATLAS — B21 (13/09/2026), FERMÉE par B24 Lot C1 (14/09/2026).
//
// Cette route restait la SEULE capable de faire passer une
// StrategicActionProposal de PROPOSEE à AUTORISEE par le chemin legacy
// (voir lib/strategic/propositions.ts, autoriserProposition). Depuis B24
// Lot C1, cette capacité est structurellement fermée : `autoriserProposition`
// refuse désormais INCONDITIONNELLEMENT toute nouvelle autorisation (voir
// l'en-tête de ce fichier), donc cette route ne peut plus jamais produire
// AUTORISEE. Conservée (plutôt que supprimée) pour ne pas casser les
// appelants existants et pour renvoyer un message explicite plutôt qu'un
// 404 — mais aucune écriture StrategicAuthorization n'est plus jamais
// possible ici. La seule autorité active pour toute NOUVELLE autorisation
// est désormais B22, via POST /api/strategic/propositions/[id]/request-authorization
// (lib/strategic/authorization-request.ts, demanderAutorisationStrategique
// — strictement inchangé par ce lot).
//
// RÈGLE ABSOLUE HISTORIQUE (directive B21, "ne jamais s'auto-autoriser") :
// `autorisateurEmail` n'était JAMAIS lu depuis le corps de la requête — il
// était TOUJOURS dérivé de `session.email` (la session ADMIN authentifiée).
// Ce mécanisme reste en place ci-dessous par cohérence, bien que devenu
// sans effet sur le résultat (toujours refusé).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);

    const resultat = await autoriserProposition({
      proposalId: params.id,
      // Dérivé de la session serveur — jamais du corps de la requête (voir
      // en-tête).
      autorisateurEmail: session.email,
      scope: typeof body?.scope === "string" ? body.scope : "",
      duree: typeof body?.duree === "string" ? body.duree : "",
      budget: typeof body?.budget === "string" ? body.budget : undefined,
      limites: typeof body?.limites === "string" ? body.limites : undefined,
    });

    // B24 Lot C1 : `resultat.ok` est désormais TOUJOURS `false` — cette
    // route est structurellement fermée (voir en-tête). 403, pas 400 : ce
    // n'est jamais une erreur de validation de la requête, c'est un refus
    // de politique — même sémantique que le refus ADMIN ci-dessus, cohérent
    // avec les conventions déjà en place dans app/api/strategic/*.
    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur }, { status: 403 });
    }

    return NextResponse.json({ id: resultat.id, statut: "AUTORISEE", autorisateurEmail: session.email });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de l'autorisation." }, { status: 500 });
  }
}
