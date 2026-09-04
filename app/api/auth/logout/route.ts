import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

// Déconnexion, accessible aux 3 rôles (ADMIN, INGENIEUR, CLIENT) — supprime
// simplement le cookie de session (voir lib/auth.ts). Volontairement en
// POST plutôt qu'en GET : une déconnexion change l'état du serveur (la
// session), elle ne doit donc pas pouvoir être déclenchée par un simple lien
// ou un prefetch. Voir components/BoutonDeconnexion.tsx pour l'appel.
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
