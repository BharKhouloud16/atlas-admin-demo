import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { bleu, bordure, fondClair, grisTexte } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";

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
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoAtlas href="/client" />
          <span style={{ fontSize: 12, fontWeight: 600, color: grisTexte, borderLeft: `1px solid ${bordure}`, paddingLeft: 14 }}>
            Espace Partenaire
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <nav style={{ display: "flex", gap: 16 }}>
            <Link href="/client" style={{ fontSize: 13, color: grisTexte, textDecoration: "none" }}>
              Missions
            </Link>
            <Link href="/client/talent" style={{ fontSize: 13, color: bleu, textDecoration: "none", fontWeight: 600 }}>
              Talent
            </Link>
          </nav>
          <span style={{ fontSize: 13, color: grisTexte }}>{session.email}</span>
          <BoutonDeconnexion />
        </div>
      </header>
      <main
        style={{
          padding: 24,
          maxWidth: 800,
          margin: "24px auto",
          background: "#fff",
          borderRadius: 12,
          border: `1px solid ${bordure}`,
        }}
      >
        {children}
      </main>
    </div>
  );
}
