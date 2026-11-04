import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ReactivationCompte from "./ReactivationCompte";

// Écran unique accessible à un ingénieur ayant désactivé son profil (voir
// middleware.ts, qui y renvoie toutes ses autres pages, et
// /api/ingenieur/compte/reactiver). Le middleware ne filtre que l'accès :
// l'état réel de la session est revérifié ici.
export default async function CompteDesactivePage() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.role === "ADMIN") redirect("/admin");
  if (session.role !== "INGENIEUR") redirect("/connexion");
  if (session.desactive !== true) redirect("/ingenieur");

  return <ReactivationCompte />;
}
