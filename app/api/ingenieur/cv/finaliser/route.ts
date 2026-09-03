import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Appelé une fois que l'ingénieur a validé (OK) tous les champs extraits de
// son CV. Marque le profil comme cvValide=true, ce qui débloque l'accès à
// l'espace ingénieur (voir app/admin/layout.tsx).
//
// TODO (analyse-profil) : une fois l'IA branchée, c'est ici qu'on
// déclencherait l'analyse du profil (années d'expérience, séniorité, points
// forts, TJM estimé, type de contrat suggéré) à partir des InfoCV validées,
// pour alimenter les champs correspondants sur Profil et servir ensuite au
// matching / scoring côté partenaire.
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

  await prisma.profil.update({
    where: { id: session.profilId },
    data: { cvValide: true },
  });

  return NextResponse.json({ ok: true });
}
