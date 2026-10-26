import { NextResponse } from "next/server";

// V1 — gestion contrôlée des erreurs serveur des routes API sensibles
// (connexion, inscription). Objectif : une base PostgreSQL injoignable
// (ex. PrismaClientInitializationError « tenant/user … not found »,
// P1001 « Can't reach database server ») doit produire une réponse JSON 503
// explicite, jamais une exception non gérée (500 HTML / corps vide) que le
// front ne sait pas lire. Aucune erreur n'est transformée en succès.

import { estIndisponibiliteBase, resumeErreurJournalisable } from "@/lib/db-errors";

export { estIndisponibiliteBase, resumeErreurJournalisable };

export const MESSAGE_SERVICE_INDISPONIBLE =
  "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.";
export const MESSAGE_ERREUR_INATTENDUE = "Une erreur inattendue est survenue. Merci de réessayer.";

// Réponse JSON contrôlée pour une erreur non prévue dans une route API.
// 503 + Retry-After si la base est indisponible, 500 sinon — jamais de détail
// technique renvoyé au navigateur.
export function reponseErreurServeur(erreur: unknown, route: string): NextResponse {
  const indisponible = estIndisponibiliteBase(erreur);
  console.error(`[${route}] ${indisponible ? "base indisponible" : "erreur inattendue"} : ${resumeErreurJournalisable(erreur)}`);
  if (indisponible) {
    return NextResponse.json(
      { error: MESSAGE_SERVICE_INDISPONIBLE, code: "SERVICE_INDISPONIBLE" },
      { status: 503, headers: { "Retry-After": "30" } }
    );
  }
  return NextResponse.json({ error: MESSAGE_ERREUR_INATTENDUE, code: "ERREUR_INTERNE" }, { status: 500 });
}

// Lecture du corps JSON d'une requête : `null` si le corps est absent ou
// n'est pas du JSON valide (la route renvoie alors un 400 plutôt qu'un 500).
export async function lireCorpsJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
