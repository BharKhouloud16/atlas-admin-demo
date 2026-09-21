import { SignJWT } from "jose";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";

// COMPANY ATLAS — correctif CI (21/09/2026) : contexte de requête authentifié
// pour un compte FRAÎCHEMENT créé par un test, SANS passer par
// POST /api/auth/login.
//
// Pourquoi : lib/rate-limit.ts partage UN compteur RATE_LIMIT_LOGIN_MAX_IP
// pour la suite entière (toutes les requêtes `next start` en CI partagent
// une IP). storageState (tests/setup/auth.setup.ts) résout ce problème pour
// les 3 comptes de démo fixes, mais plusieurs suites (v25-communication-lot3,
// lot5...) testent explicitement des comptes FRAÎCHEMENT créés par test
// (individualité par User.id) — storageState ne s'applique qu'à des fichiers
// statiques, pas à un compte connu seulement à l'exécution.
//
// Solution : signer nous-mêmes le même JWT que lib/auth.ts::createSession()
// (même secret SESSION_SECRET, même algorithme HS256, même structure de
// payload) et l'injecter directement comme cookie dans un nouveau contexte
// de requête Playwright — zéro appel à /api/auth/login, donc zéro
// contribution au compteur de rate-limit partagé. La session obtenue est
// byte-pour-byte identique à celle qu'un vrai login produirait (vérifiée
// par le même getSession()/jwtVerify côté serveur) : aucune faiblesse de
// test introduite, seulement le contournement d'un coût d'infrastructure
// (l'appel HTTP de connexion lui-même, jamais testé par ces suites).
const encodeur = new TextEncoder();

type RoleSession = "ADMIN" | "INGENIEUR" | "CLIENT";

export async function contexteConnecte(user: {
  email: string;
  role: RoleSession;
  profilId?: string | null;
  clientId?: string | null;
  desactive?: boolean;
}): Promise<APIRequestContext> {
  const secret = encodeur.encode(process.env.SESSION_SECRET);
  const token = await new SignJWT({
    email: user.email,
    role: user.role,
    profilId: user.profilId ?? null,
    clientId: user.clientId ?? null,
    desactive: user.desactive ?? false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);

  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  return pwRequest.newContext({
    baseURL,
    storageState: {
      cookies: [
        {
          name: "atlas_session",
          value: token,
          domain: new URL(baseURL).hostname,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
}
