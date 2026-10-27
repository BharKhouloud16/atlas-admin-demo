import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { analyserProfilDepuisCV } from "@/lib/analyse-profil";

// Appelé une fois que l'ingénieur a validé (OK) tous les champs extraits de
// son CV. Marque le profil comme cvValide=true, ce qui débloque l'accès à
// l'espace ingénieur (voir app/admin/layout.tsx).
//
// ENGINEER PROFILE V2 — Lot 3 (ferme le TODO précédent) : alimente
// Profil.anneesExperience / Profil.seniorite à partir des InfoCV désormais
// TOUTES validées (donc confirmées par l'ingénieur lui-même) via
// lib/analyse-profil.ts — jamais une invention : un texte absent ou ambigu
// laisse le champ à null (voir analyserProfilDepuisCV). tjmEstime reste
// volontairement hors de ce lot : aucune formule de déduction non
// arbitraire n'existe aujourd'hui dans ce dépôt (voir lib/analyse-profil.ts,
// en-tête) — reste un champ à renseignement manuel (Admin), comme
// aujourd'hui, plutôt que d'inventer un chiffre.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const restants = await prisma.infoCV.count({
    where: { profilId: session.profilId, valide: false },
  });
  if (restants > 0) {
    return NextResponse.json(
      { error: `${restants} information(s) restent à valider avant de finaliser.` },
      { status: 400 }
    );
  }

  const infosCv = await prisma.infoCV.findMany({
    where: { profilId: session.profilId, valide: true },
    select: { categorie: true, libelle: true, valeur: true },
  });
  const analyse = analyserProfilDepuisCV(infosCv);

  await prisma.profil.update({
    where: { id: session.profilId },
    data: {
      cvValide: true,
      anneesExperience: analyse.anneesExperience,
      seniorite: analyse.seniorite,
    },
  });

  return NextResponse.json({ ok: true });
}
