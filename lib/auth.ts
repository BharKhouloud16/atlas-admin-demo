import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { secretCourant, secretsVerification } from "@/lib/session-secret";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "atlas_session";
const SESSION_DURATION = "8h";

type SessionUser = {
  email: string;
  role: "ADMIN" | "INGENIEUR" | "CLIENT";
  profilId: string | null;
  clientId: string | null;
  desactive?: boolean; // true pour un ingénieur ayant temporairement désactivé son compte
};

// Version des sessions du compte (User.sessionVersion), portée par le jeton
// dans la revendication "sv". Un jeton émis avant son introduction n'en a
// pas : il vaut 0, donc reste valide tant que le compte n'a jamais révoqué
// ses sessions.
type JetonSession = SessionUser & { sv?: number };

async function versionSessionsCompte(email: string): Promise<number | null> {
  const compte = await prisma.user.findUnique({ where: { email }, select: { sessionVersion: true } });
  return compte ? compte.sessionVersion : null;
}

// Pour révoquer les autres sessions, incrémenter User.sessionVersion puis
// rappeler createSession() pour la session courante (elle relit la version).
export async function createSession(user: SessionUser) {
  const sv = (await versionSessionsCompte(user.email)) ?? 0;
  const { email, role, profilId, clientId, desactive } = user;
  const token = await new SignJWT({ email, role, profilId, clientId, desactive, sv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretCourant);

  // "secure" doit refléter le protocole réel, pas seulement NODE_ENV : `next
  // start` (utilisé en CI et par Playwright, voir playwright.config.ts) tourne
  // toujours en NODE_ENV=production même en http://localhost, donc
  // `secure: NODE_ENV === "production"` posait un cookie Secure sur une
  // connexion http — Chrome (les tests e2e Playwright, un vrai navigateur)
  // refuse alors de le stocker/renvoyer, contrairement à APIRequestContext
  // (tests/api) qui n'applique pas cette règle : d'où les 5 échecs
  // tests/e2e/connexion.spec.ts (connexion "réussie" mais jamais de session,
  // donc redirection immédiate vers /connexion par le middleware) alors que
  // les mêmes comptes fonctionnaient dans tests/api. Vercel (déploiement réel)
  // termine toujours le TLS et pose l'en-tête x-forwarded-proto: https, donc
  // le comportement en production ne change pas.
  const proto = headers().get("x-forwarded-proto");
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8h, aligné sur SESSION_DURATION
  });
}

export async function destroySession() {
  cookies().delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  // Essaie le secret courant, puis l'ancien si une rotation est en cours
  // (voir lib/session-secret.ts) — un seul des deux doit vérifier le token.
  let jeton: JetonSession | null = null;
  for (const s of secretsVerification) {
    try {
      const { payload } = await jwtVerify(token, s);
      jeton = payload as unknown as JetonSession;
      break;
    } catch {
      // essaie le secret suivant (ou échoue définitivement ci-dessous)
    }
  }
  if (!jeton) return null;
  // Jeton signé mais révoqué : compte supprimé, ou version dépassée par un
  // changement / une réinitialisation du mot de passe.
  const version = await versionSessionsCompte(jeton.email);
  if (version === null || (jeton.sv ?? 0) !== version) return null;
  return jeton;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
