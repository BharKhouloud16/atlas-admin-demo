import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { bordure, fondClair, grisTexte } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";
import ClientNav from "@/components/client/ClientNav";

// LOT 1 — Client Workspace Foundation (15/09/2026) : "Espace Partenaire" ->
// "Espace Client" (vocabulaire visible uniquement — aucun nom technique
// touché : routes, session.role "CLIENT", modèle Prisma Client, etc.
// restent inchangés). Navigation étendue de 2 à 10 rubriques (voir
// components/client/ClientNav.tsx) et largeur de contenu augmentée
// (800px -> 1080px) pour accueillir la nouvelle Vue d'ensemble sans que
// chaque section soit compressée sur une seule colonne étroite.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT") {
    redirect("/connexion");
  }

  return (
    <div style={{ minHeight: "100vh", background: fondClair }}>
      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${bordure}`,
          padding: "14px 24px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoAtlas href="/client" />
          <span style={{ fontSize: 12, fontWeight: 600, color: grisTexte, borderLeft: `1px solid ${bordure}`, paddingLeft: 14 }}>
            Espace Client
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: grisTexte }}>{session.email}</span>
          <BoutonDeconnexion />
        </div>
      </header>
      <div
        style={{
          padding: "12px 24px",
          background: "#fff",
          borderBottom: `1px solid ${bordure}`,
        }}
      >
        <ClientNav />
      </div>
      <main
        style={{
          padding: 24,
          maxWidth: 1080,
          margin: "24px auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
