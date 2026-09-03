import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EspaceIngenieur from "./EspaceIngenieur";

// Espace principal de l'ingénieur, accessible une fois le CV importé,
// validé, et le questionnaire de disponibilité rempli (sinon redirection
// vers l'étape correspondante, comme dans app/admin/layout.tsx).
export default async function IngenieurPage() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    redirect("/connexion");
  }

  const profil = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: { cvUrl: true, cvValide: true, questionnaireValide: true },
  });

  if (!profil || !profil.cvUrl) redirect("/ingenieur/cv");
  if (!profil.cvValide) redirect("/ingenieur/cv/verifier");
  if (!profil.questionnaireValide) redirect("/ingenieur/disponibilite");

  return <EspaceIngenieur />;
}
