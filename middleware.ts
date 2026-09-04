import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Pages/routes publiques, jamais protégées
const PUBLIC_PATHS = [
  "/connexion",
  "/inscription",
  "/api/auth/login",
  "/api/auth/signup",
  "/verifier-email",
  "/api/auth/verifier-email",
  "/api/auth/renvoyer-verification",
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
const SHARED_PREFIXES = ["/api/feuilles-de-temps", "/api/evaluations"];

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected =
    !PUBLIC_PATHS.includes(pathname) &&
    (pathname.startsWith("/admin") || pathname.startsWith("/client") || pathname.startsWith("/ingenieur") ||
     pathname.startsWith("/api/clients") || pathname.startsWith("/api/profils") ||
     pathname.startsWith("/api/missions") || pathname.startsWith("/api/generate-contract") ||
     pathname.startsWith("/api/comptes") || pathname.startsWith("/api/client") || pathname.startsWith("/api/ingenieur") ||
     SHARED_PREFIXES.some((p) => pathname.startsWith(p)));

  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get("atlas_session")?.value;
  if (!token) return redirectToLogin(req);

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;

    if (role === "CLIENT") {
      const allowed =
        pathname === "/admin"
          ? false
          : CLIENT_PREFIXES.some((p) => pathname.startsWith(p)) || SHARED_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) return redirectToLogin(req, "/client");
    }

    if (role === "INGENIEUR") {
      const allowed =
        pathname === "/admin" ||
        INGENIEUR_PREFIXES.some((p) => pathname.startsWith(p)) ||
        SHARED_PREFIXES.some((p) => pathname.startsWith(p));
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
  ],
};
