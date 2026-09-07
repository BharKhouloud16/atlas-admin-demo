import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { construireObservations } from "@/lib/quality/evidence";
import { deriverTousLesSignaux } from "@/lib/quality/signals";
import { construireTousLesDimensionSnapshots } from "@/lib/quality/dimensions";
import { evaluerGates } from "@/lib/quality/gates";
import { extraireTousLesCasDeRegression } from "@/lib/quality/regression";
import { recupererObservationsCiGithub } from "@/lib/quality/sources/ci-github";

// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.7). Première route API du
// Signal Engine : lecture seule, aucune écriture, aucune persistance.
// Assemble en UNE seule lecture externe (le dernier lot de runs CI
// réellement observés sur GitHub Actions — priorité #1 de la directive
// Signal Engine, Batch 12.3) la chaîne complète déjà construite :
// OBSERVATION (Batch 12.1/12.2) -> SIGNAL (Batch 12.3) -> DIMENSION
// (Batch 12.4) -> GATE (Batch 12.5) -> RÉGRESSION (Batch 12.6). Réservé
// Admin : les preuves citées (URLs de run, noms de workflow) restent un
// usage interne de pilotage qualité, jamais un usage Client ni Ingénieur.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1-12.6, reconduites ici) :
// - ZÉRO score, zéro verdict de synthèse : la réponse reste la LISTE de
//   Gates indépendants (Batch 12.5), jamais combinée en un statut global.
// - ZÉRO persistance : aucune table Prisma, aucune écriture, aucun
//   historique reconstruit — uniquement ce que GitHub rapporte à l'instant
//   de l'appel (voir lib/quality/sources/ci-github.ts). Une panne réseau ou
//   un dépôt sans run retourne honnêtement des tableaux vides -> tous les
//   Gates ressortent UNKNOWN (Batch 12.5), jamais PASS/FAIL présumé.
// - Une seule lecture externe pour toute la requête (pas de N+1) : le
//   fetch GitHub Actions est effectué une fois, puis toute la dérivation
//   (signaux/dimensions/gates/régressions) est un calcul pur en mémoire.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B11.
//
// SÉCURITÉ (Batch 12.8, renforcement — RBAC serveur réutilisé tel quel,
// aucun nouveau système d'autorisation) :
// - Seul GET est exporté : toute autre méthode (POST/PUT/DELETE/PATCH) sur
//   /api/quality reçoit automatiquement un 405 Method Not Allowed par le
//   routeur Next.js App Router (aucun handler additionnel n'est défini pour
//   ces méthodes — comportement natif, jamais recodé à la main).
// - Aucun paramètre de requête, aucun corps : rien à valider côté entrée
//   utilisateur pour cette route (seule la source externe, déjà validée
//   dans lib/quality/sources/ci-github.ts, est une entrée non fiable).
// - Isolation locataire (tenant) : non applicable ici — cette route
//   n'expose AUCUNE donnée Client/Ingénieur/Profil (contrairement à
//   /api/profils/[id]/talent-trust etc.), uniquement des métadonnées de
//   run CI du dépôt ATLAS lui-même (voir classification des données dans
//   lib/quality/sources/ci-github.ts). Aucun paramètre d'identifiant en
//   entrée -> aucune énumération d'ID possible.
// - Gestion des erreurs : toute exception inattendue (ex. session illisible)
//   est interceptée et retourne un 500 générique, jamais la stack trace ni
//   le détail interne de l'erreur — même discipline que pour une panne de
//   la source CI (jamais un plantage serveur visible côté client).

const DEPOT_QUALITE_PAR_DEFAUT = { owner: "BharKhouloud16", repo: "atlas-admin-demo" };

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const owner = process.env.ATLAS_QUALITY_REPO_OWNER || DEPOT_QUALITE_PAR_DEFAUT.owner;
    const repo = process.env.ATLAS_QUALITY_REPO_NAME || DEPOT_QUALITE_PAR_DEFAUT.repo;

    const entreesCi = await recupererObservationsCiGithub({ owner, repo });
    const { observations, rejetees } = construireObservations(entreesCi);
    const signaux = deriverTousLesSignaux(observations);
    const dimensions = construireTousLesDimensionSnapshots(observations, signaux);
    const gates = evaluerGates(dimensions);
    const regressions = extraireTousLesCasDeRegression(signaux);

    return NextResponse.json({
      source: { owner, repo, observationsRejetees: rejetees },
      observations,
      signaux,
      dimensions,
      gates,
      regressions,
    });
  } catch {
    // Jamais de stack trace ni de détail interne exposé au client — voir
    // note SÉCURITÉ ci-dessus.
    return NextResponse.json({ error: "Erreur interne lors du calcul de l'état qualité." }, { status: 500 });
  }
}
