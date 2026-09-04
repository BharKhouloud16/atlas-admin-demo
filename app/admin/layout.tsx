import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bleuFonce, grisTexte, bordure, fondClair } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";
import NavAdmin from "@/components/NavAdmin";

const LIENS_NAV = [
  { href: "/admin", label: "Tableau de bord", roles: ["ADMIN", "INGENIEUR"] },
  { href: "/admin/recherche", label: "Recherche", roles: ["ADMIN"] },
  { href: "/admin/missions", label: "Missions", roles: ["ADMIN", "INGENIEUR"] },
  { href: "/admin/clients", label: "Clients", roles: ["ADMIN"] },
  { href: "/admin/ingenieurs", label: "Ingénieurs", roles: ["ADMIN"] },
  { href: "/admin/profils", label: "Profils", roles: ["ADMIN"] },
  { href: "/admin/feuilles-de-temps", label: "Feuilles de temps", roles: ["ADMIN"] },
  { href: "/admin/demandes", label: "Demandes de contact", roles: ["ADMIN"] },
  { href: "/admin/comptes-en-attente", label: "Comptes en attente", roles: ["ADMIN"] },
  { href: "/admin/journal", label: "Journal d'activité", roles: ["ADMIN"] },
  { href: "/admin/securite", label: "Sécurité (2FA)", roles: ["ADMIN"] },
] as const;

const LABEL_ROLE: Record<string, string> = {
  ADMIN: "Administrateur",
  INGENIEUR: "Ingénieur",
};

// Tableau de bord Admin — et, pour /admin/missions uniquement, également
// utilisé par un compte INGENIEUR (voir plus bas). Reprend la charte
// graphique de la page d'accueil (voir app/page.tsx et lib/theme.ts) :
// logo, palette bleu/bleuFonce, plutôt que le rendu texte brut d'origine.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Le middleware protège déjà ces routes, mais on revérifie ici pour
  // ne jamais rendre de contenu admin sans session valide (defense in depth).
  const session = await getSession();
  if (!session || session.role === "CLIENT") {
    redirect("/connexion");
  }

  // Un ingénieur doit d'abord importer son CV, valider chaque information
  // extraite, puis renseigner sa disponibilité, avant d'accéder à son espace
  // (voir /ingenieur/cv, /ingenieur/cv/verifier et /ingenieur/disponibilite).
  // Une fois ces étapes faites, son espace principal est /ingenieur (et non
  // plus ce tableau de bord admin) : /admin/missions reste accessible depuis
  // la navigation, mais /admin lui-même redirige vers /ingenieur.
  if (session.role === "INGENIEUR" && session.profilId) {
    const profil = await prisma.profil.findUnique({
      where: { id: session.profilId },
      select: { cvUrl: true, cvValide: true, questionnaireValide: true },
    });
    if (profil && !profil.cvUrl) redirect("/ingenieur/cv");
    if (profil && profil.cvUrl && !profil.cvValide) redirect("/ingenieur/cv/verifier");
    if (profil && profil.cvValide && !profil.questionnaireValide) redirect("/ingenieur/disponibilite");
  }

  const liens = LIENS_NAV.filter((l) => (l.roles as readonly string[]).includes(session.role));

  return (
    <div style={{ minHeight: "100vh", background: fondClair }}>
      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${bordure}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <LogoAtlas href="/admin" />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 13, color: grisTexte }}>
            {session.email} <span style={{ color: "#c3c9d4" }}>·</span> {LABEL_ROLE[session.role] ?? session.role}
          </span>
          <BoutonDeconnexion />
        </div>
      </header>

      <div style={{ display: "flex", maxWidth: 1280, margin: "0 auto" }}>
        <nav style={{ width: 220, flexShrink: 0, padding: "24px 16px" }}>
          <NavAdmin liens={liens} />
        </nav>
        <main style={{ flex: 1, minWidth: 0, padding: "24px 24px 48px", background: "#fff", margin: "24px 24px 24px 0", borderRadius: 12, border: `1px solid ${bordure}` }}>
          {children}
        </main>
      </div>
    </div>
  );
}
