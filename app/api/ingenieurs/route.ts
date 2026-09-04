import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Liste des comptes ingénieurs validés (voir /admin/ingenieurs) — distincte
// de /admin/comptes-en-attente (comptes pas encore validés) et de
// /admin/profils (matching). Réservée à l'Admin.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const ingenieurs = await prisma.user.findMany({
    where: { role: "INGENIEUR", actif: true },
    orderBy: { valideLe: "desc" },
    select: {
      id: true,
      email: true,
      createdAt: true,
      valideLe: true,
      premiereConnexionLe: true,
      desactive: true,
      profil: { select: { nom: true, prenom: true, cvValide: true, disponibilite: true } },
    },
  });

  return NextResponse.json(ingenieurs);
}
