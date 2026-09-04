import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const MAX_REALISATIONS = 10;
const MAX_TITRE = 100;
const MAX_DESCRIPTION = 600;
const MAX_LIEN = 300;

export type Realisation = { id: string; titre: string; description: string; lien: string | null };

function validerRealisations(valeur: unknown): { ok: true; realisations: Realisation[] } | { ok: false; erreur: string } {
  if (!Array.isArray(valeur)) return { ok: false, erreur: "Format invalide." };
  if (valeur.length > MAX_REALISATIONS) {
    return { ok: false, erreur: `Maximum ${MAX_REALISATIONS} réalisations.` };
  }
  const realisations: Realisation[] = [];
  for (const item of valeur) {
    if (!item || typeof item !== "object") return { ok: false, erreur: "Format invalide." };
    const titre = String((item as Record<string, unknown>).titre ?? "").trim();
    const description = String((item as Record<string, unknown>).description ?? "").trim();
    const lienBrut = (item as Record<string, unknown>).lien;
    const lien = lienBrut ? String(lienBrut).trim() : "";
    if (!titre) return { ok: false, erreur: "Chaque réalisation doit avoir un titre." };
    if (titre.length > MAX_TITRE) return { ok: false, erreur: `Titre trop long (max ${MAX_TITRE} caractères).` };
    if (description.length > MAX_DESCRIPTION) {
      return { ok: false, erreur: `Description trop longue (max ${MAX_DESCRIPTION} caractères).` };
    }
    if (lien.length > MAX_LIEN) return { ok: false, erreur: `Lien trop long (max ${MAX_LIEN} caractères).` };
    if (lien && !/^https?:\/\//i.test(lien)) {
      return { ok: false, erreur: "Le lien doit commencer par http:// ou https://." };
    }
    realisations.push({
      id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : crypto.randomUUID(),
      titre,
      description,
      lien: lien || null,
    });
  }
  return { ok: true, realisations };
}

// Remplace l'intégralité du portfolio de réalisations de l'ingénieur
// connecté — voir Profil.realisations dans prisma/schema.prisma. On
// remplace tout le tableau plutôt que d'exposer un CRUD par élément : plus
// simple côté client (un seul état React édité localement, sauvegardé en
// un clic) et le volume (max 10 éléments) ne justifie pas plus.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const validation = validerRealisations(body.realisations);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.erreur }, { status: 400 });
  }

  await prisma.profil.update({
    where: { id: session.profilId },
    data: { realisations: validation.realisations },
  });

  return NextResponse.json({ realisations: validation.realisations });
}
