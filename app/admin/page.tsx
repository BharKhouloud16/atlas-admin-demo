import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Un ingénieur qui a terminé son CV et son questionnaire de disponibilité a
// désormais son propre espace (/ingenieur) : ce tableau de bord ne lui est
// plus destiné. /admin/missions reste accessible depuis la navigation.
export default async function AdminHome() {
  const session = await getSession();
  if (session?.role === "INGENIEUR") {
    redirect("/ingenieur");
  }

  return (
    <div>
      <h1>Tableau de bord</h1>
      <p>Gérez vos clients, vos profils d'ingénieurs et vos missions, puis générez les contrats en un clic depuis l'onglet Missions.</p>
    </div>
  );
}
