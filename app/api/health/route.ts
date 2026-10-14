import { NextResponse } from "next/server";

// LOT 12.1 — SECURITY HARDENING : healthcheck minimal pour l'infrastructure
// (Vercel, monitoring externe) — confirme uniquement que le serveur Next.js
// répond, sans vérifier de dépendance externe (DB, stockage...). Un
// healthcheck qui dépend de services tiers peut signaler l'application
// comme "down" alors qu'elle fonctionne réellement, pour une panne qui n'est
// pas la sienne. Volontairement non authentifié (l'infrastructure doit
// pouvoir l'appeler sans session) et volontairement minimal : aucune
// information interne (pas de DATABASE_URL, pas de secret, pas de version,
// pas de stack trace) n'est jamais exposée par cette route.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
