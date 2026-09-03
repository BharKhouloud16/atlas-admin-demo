import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Secret défini dans .env — jamais commité (voir .env.example)
const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
const COOKIE_NAME = "atlas_session";
const SESSION_DURATION = "8h";

type SessionUser = {
  email: string;
  role: "ADMIN" | "INGENIEUR" | "CLIENT";
  profilId: string | null;
  clientId: string | null;
};

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret);

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
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    // token expiré ou invalide
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
