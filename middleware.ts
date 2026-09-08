import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { secretsVerification } from "@/lib/session-secret";

// Pages/routes publiques, jamais protégées
const PUBLIC_PATHS = [
  "/connexion",
  "/inscription",
  "/api/auth/login",
  "/api/auth/signup",
  "/verifier-email",
  "/api/auth/verifier-email",
  "/api/auth/renvoyer-verification",
  // B14 — mot de passe oublié : listées ici pour la même raison que
  // verifier-email ci-dessus (documentation explicite de l'allowlist),
  // bien qu'aucune ne matche déjà les préfixes protégés plus bas.
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/api/auth/mot-de-passe-oublie",
  "/api/auth/reinitialiser-mot-de-passe",
];

// Préfixes protégés, groupés par rôle autorisé
const ADMIN_PREFIXES = ["/admin/clients", "/admin/ingenieurs", "/admin/profils", "/admin/comptes-en-attente", "/admin/feuilles-de-temps",
  "/api/clients", "/api/ingenieurs", "/api/profils", "/api/comptes", "/api/generate-contract"];
const INGENIEUR_PREFIXES = ["/admin/missions", "/api/missions", "/ingenieur", "/api/ingenieur"]; // aussi accessible à ADMIN
// "/api/client/" se termine par un slash pour ne matcher QUE les routes
// client (/api/client/missions, /api/client/documents...) — un préfixe nu
// "/api/client" matchait aussi "/api/clients" (route Admin) par erreur via
// startsWith, ce qui bloquait l'Admin sur /admin/clients (bug trouvé le 4
// sept. lors du test de la nouvelle page /admin/clients).
const CLIENT_PREFIXES = ["/client", "/api/client/"];
// Endpoints partagés entre les 3 rôles, chaque route gérant elle-même le
// détail des permissions (voir app/api/feuilles-de-temps et
// app/api/evaluations) — accessibles à ADMIN par défaut (cf. plus bas),
// et explicitement ajoutés aux listes autorisées de INGENIEUR et CLIENT
// sans passer par CLIENT_PREFIXES (qui déclenche le blocage ADMIN ci-dessous).
//
// FIX B16 (08/09/2026) — /api/generate-contract a été ajouté ici après un
// audit de la chaîne d'authorization/traçabilité (directive B16, sections
// 2 et 3) : cette route était protégée uniquement par le matcher +
// ADMIN_PREFIXES (jamais réellement lu ci-dessous), ce qui la laissait
// bloquée pour CLIENT/INGENIEUR directement par le middleware (Edge
// runtime, sans accès Prisma) AVANT même d'atteindre le handler Node.js —
// le contrôle ADMIN-only et la journalisation d'événement de sécurité
// (rbac.acces_refuse) déjà présents dans app/api/generate-contract/route.ts
// n'étaient donc jamais exécutés pour ces rôles, un mort-code découvert par
// les tests d'audit B16. Le comportement de sécurité observable ne change
// pas (toujours 403 pour CLIENT/INGENIEUR), mais l'autorisation ET la
// traçabilité sont désormais assurées par la route elle-même — même
// discipline de défense en profondeur que feuilles-de-temps/evaluations.
//
// FIX B17 (08/09/2026) — même pattern confirmé et corrigé pour
// /api/missions et /api/clients (directive B17, section 1 : "étendre la
// journalisation des refus RBAC actuellement bloqués par le middleware").
// Inspection réelle du code (pas d'hypothèse) : app/api/missions/route.ts
// bloque déjà CLIENT en GET ("Utilisez /api/client/missions") et impose
// déjà ADMIN en POST ; app/api/clients/route.ts impose déjà ADMIN en GET
// et POST, avec le commentaire explicite "le middleware protège déjà
// /api/clients, mais on revérifie le rôle ici (defense in depth)" — ces
// contrôles route existaient donc AVANT B17 mais restaient inatteignables
// pour CLIENT (les deux routes) et pour INGENIEUR (/api/clients) car le
// middleware bloquait en amont sans jamais les exécuter, empêchant toute
// journalisation. Même correctif minimal que /api/generate-contract :
// laisser passer l'utilisateur authentifié, la route reste seule
// responsable de l'autorisation exacte (elle l'était déjà). Comportement
// observable inchangé (toujours 403 pour un rôle non autorisé) ;
// /api/missions/[id]/marge-intelligence hérite du même préfixe
// "/api/missions" et bénéficie du même correctif sans modification
// séparée.
const SHARED_PREFIXES = ["/api/feuilles-de-temps", "/api/evaluations", "/api/generate-contract", "/api/missions", "/api/clients"];
// ATLAS TALENT V1 (fondations, 06/09) — réservé à CLIENT (sa propre
// DemandeTalent) et ADMIN (matching/shortlist) ; jamais l'INGENIEUR. Chaque
// route vérifie aussi elle-même le rôle exact (voir
// app/api/talent/demandes/*) — cette liste ne fait que laisser passer le
// middleware, la défense en profondeur reste dans la route.
const TALENT_PREFIXES = ["/api/talent"];

// Vérifie le token avec le secret courant, puis l'ancien si une rotation de
// SESSION_SECRET est en cours (voir lib/session-secret.ts) — jose lève une
// exception dès le premier échec, donc on essaie chaque secret à la main.
async function verifierToken(token: string) {
  for (const s of secretsVerification) {
    try {
      return await jwtVerify(token, s);
    } catch {
      // essaie le secret suivant
    }
  }
  throw new Error("Token invalide pour tous les secrets connus");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected =
    !PUBLIC_PATHS.includes(pathname) &&
    (pathname.startsWith("/admin") || pathname.startsWith("/client") || pathname.startsWith("/ingenieur") ||
      pathname.startsWith("/api/clients") || pathname.startsWith("/api/profils") ||
      pathname.startsWith("/api/missions") || pathname.startsWith("/api/generate-contract") ||
      pathname.startsWith("/api/comptes") || pathname.startsWith("/api/client") || pathname.startsWith("/api/ingenieur") ||
      SHARED_PREFIXES.some((p) => pathname.startsWith(p)) || TALENT_PREFIXES.some((p) => pathname.startsWith(p)));

  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get("atlas_session")?.value;
  if (!token) return redirectToLogin(req);

  try {
    const { payload } = await verifierToken(token);
    const role = payload.role as string;

    if (role === "CLIENT") {
      const allowed =
        pathname === "/admin"
          ? false
          : CLIENT_PREFIXES.some((p) => pathname.startsWith(p)) ||
            SHARED_PREFIXES.some((p) => pathname.startsWith(p)) ||
            TALENT_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) return redirectToLogin(req, "/client");
    }

    if (role === "INGENIEUR") {
      const allowed =
        pathname === "/admin" ||
        INGENIEUR_PREFIXES.some((p) => pathname.startsWith(p)) ||
        SHARED_PREFIXES.some((p) => pathname.startsWith(p));
      // ATLAS TALENT n'est volontairement pas dans SHARED_PREFIXES ni ici :
      // un Ingénieur n'a jamais accès à /api/talent (ni côté Client, ni
      // matching/shortlist réservé Admin).
      if (!allowed) return redirectToLogin(req, "/admin/missions");

      // Compte temporairement désactivé par l'ingénieur lui-même (voir
      // /ingenieur -> "Mon compte") : seul l'écran de réactivation (et son
      // API) reste accessible tant qu'il ne s'est pas réactivé.
      if (payload.desactive === true) {
        const autorisePendantDesactivation =
          pathname === "/ingenieur/compte-desactive" || pathname.startsWith("/api/ingenieur/compte");
        if (!autorisePendantDesactivation) {
          if (pathname.startsWith("/api")) {
            return NextResponse.json({ error: "Compte désactivé." }, { status: 403 });
          }
          return NextResponse.redirect(new URL("/ingenieur/compte-desactive", req.url));
        }
      }
    }

    if (role === "ADMIN" && CLIENT_PREFIXES.some((p) => pathname.startsWith(p))) {
      // un admin n'a pas d'espace client à consulter (pas de clientId en session)
      return redirectToLogin(req, "/admin");
    }

    return NextResponse.next();
  } catch {
    return redirectToLogin(req);
  }
}

function redirectToLogin(req: NextRequest, fallback = "/connexion") {
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  return NextResponse.redirect(new URL(fallback, req.url));
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/client/:path*",
    "/ingenieur/:path*",
    "/api/clients/:path*",
    "/api/ingenieurs/:path*",
    "/api/profils/:path*",
    "/api/missions/:path*",
    "/api/generate-contract/:path*",
    "/api/comptes/:path*",
    "/api/client/:path*",
    "/api/ingenieur/:path*",
    "/api/feuilles-de-temps/:path*",
    "/api/evaluations/:path*",
    "/api/talent/:path*",
  ],
};
