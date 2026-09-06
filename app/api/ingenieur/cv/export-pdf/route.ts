import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { genererCvPdf } from "@/lib/pdf-cv";
import type { Realisation } from "@/app/api/ingenieur/realisations/route";

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
      // Profil.realisations est un champ Json (portfolio, pas une relation —
      // voir prisma/schema.prisma) : on le récupère brut et on le valide/
      // caste ci-dessous, comme le fait déjà GET /api/ingenieur/realisations.
      realisations: true,
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

  const realisations: Realisation[] = Array.isArray(profil.realisations) ? (profil.realisations as unknown as Realisation[]) : [];

  const pdfBytes = await genererCvPdf({
    nom: profil.nom,
    prenom: profil.prenom,
    seniorite: profil.seniorite,
    anneesExperience: profil.anneesExperience,
    competences: profil.competences,
    infos: profil.infosCv,
    realisations,
  });

  const nomFichier = `CV-Atlas-${(profil.prenom ?? "").trim()}-${profil.nom}`.replace(/\s+/g, "-") + ".pdf";

  // new Uint8Array(...) (plutôt que de passer pdfBytes tel quel) : même
  // contournement que app/api/generate-contract/route.ts — le Uint8Array
  // renvoyé par pdf-lib est typé sur un ArrayBufferLike générique, pas
  // assignable au BodyInit attendu par NextResponse, alors qu'une nouvelle
  // instance Uint8Array(...) est concrètement typée sur ArrayBuffer.
  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${nomFichier}"`,
    },
  });
}
