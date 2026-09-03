import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Pages/routes publiques, jamais protégées
const PUBLIC_PATHS = ["/connexion", "/inscription", "/api/auth/login", "/api/auth/signup"];

// Préfixes protégés, groupés par rôle autorisé
const ADMIN_PREFIXES = ["/admin/clients", "/admin/profils", "/admin/comptes-en-attente",
  "/api/clients", "/api/profils", "/api/comptes", "/api/generate-contract"];
const INGENIEUR_PREFIXES = ["/admin/missions", "/api/missions"]; // aussi accessible à ADMIN
const CLIENT_PREFIXES = ["/client", "/api/client"];

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected =
    !PUBLIC_PATHS.includes(pathname) &&
    (pathname.startsWith("/admin") || pathname.startsWith("/client") ||
     pathname.startsWith("/api/clients") || pathname.startsWith("/api/profils") ||
     pathname.startsWith("/api/missions") || pathname.startsWith("/api/generate-contract") ||
     pathname.startsWith("/api/comptes") || pathname.startsWith("/api/client"));

  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get("atlas_session")?.value;
  if (!token) return redirectToLogin(req);

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;

    if (role === "CLIENT") {
      const allowed = pathname === "/admin" ? false : CLIENT_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) return redirectToLogin(req, "/client");
    }

    if (role === "INGENIEUR") {
      const allowed = pathname === "/admin" || INGENIEUR_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) return redirectToLogin(req, "/admin/missions");
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
    "/api/clients/:path*",
    "/api/profils/:path*",
    "/api/missions/:path*",
    "/api/generate-contract/:path*",
    "/api/comptes/:path*",
    "/api/client/:path*",
  ],
};
