import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { secretCourant, secretsVerification } from "@/lib/session-secret";

const COOKIE_NAME = "atlas_session";
const SESSION_DURATION = "8h";

type SessionUser = {
  email: string;
  role: "ADMIN" | "INGENIEUR" | "CLIENT";
  profilId: string | null;
  clientId: string | null;
  desactive?: boolean; // true pour un ingénieur ayant temporairement désactivé son compte
};

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretCourant);

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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
  for (const s of secretsVerification) {
    try {
      const { payload } = await jwtVerify(token, s);
      return payload as unknown as SessionUser;
    } catch {
      // essaie le secret suivant (ou échoue définitivement ci-dessous)
    }
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
