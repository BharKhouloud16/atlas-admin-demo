import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { genererCvPdf } from "@/lib/pdf-cv";

// Export PDF "CV Atlas" (voir lib/pdf-cv.ts) : reconstruit une fiche
// présentable à partir des InfoCV validées du profil, plutôt que de
// renvoyer le CV brut importé (voir GET /api/ingenieur/cv/fichier). Accès :
// l'ingénieur pour son propre profil, ou l'Admin pour n'importe quel profil
// (?profilId=...) — même règle d'accès que le reste de l'espace CV.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const profilIdDemande = req.nextUrl.searchParams.get("profilId");

  let profilId: string | null = null;
  if (session?.role === "ADMIN" && profilIdDemande) {
    profilId = profilIdDemande;
  } else if (session?.role === "INGENIEUR") {
    profilId = session.profilId;
  }

  if (!profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: profilId },
    select: {
      nom: true,
      prenom: true,
      seniorite: true,
      anneesExperience: true,
      competences: true,
      realisations: { select: { titre: true, description: true, lien: true }, orderBy: { createdAt: "asc" } },
      infosCv: {
        where: { valide: true },
        select: { categorie: true, libelle: true, valeur: true },
        orderBy: { ordre: "asc" },
      },
    },
  });

  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const pdfBytes = await genererCvPdf({
    nom: profil.nom,
    prenom: profil.prenom,
    seniorite: profil.seniorite,
    anneesExperience: profil.anneesExperience,
    competences: profil.competences,
    infos: profil.infosCv,
    realisations: profil.realisations,
  });

  const nomFichier = `CV-Atlas-${(profil.prenom ?? "").trim()}-${profil.nom}`.replace(/\s+/g, "-") + ".pdf";

  return new NextResponse(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${nomFichier}"`,
    },
  });
}
