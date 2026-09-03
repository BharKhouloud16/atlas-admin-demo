import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Le middleware protège déjà ces routes, mais on revérifie ici pour
  // ne jamais rendre de contenu admin sans session valide (defense in depth).
  const session = await getSession();
  if (!session || session.role === "CLIENT") {
    redirect("/connexion");
  }

  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav style={{ width: 200, borderRight: "1px solid #e5e5e5", padding: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Atlas admin</p>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>{session.role}</p>
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <li><Link href="/admin">Tableau de bord</Link></li>
              <li><Link href="/admin/missions">Missions</Link></li>
              {session.role === "ADMIN" && <li><Link href="/admin/clients">Clients</Link></li>}
              {session.role === "ADMIN" && <li><Link href="/admin/profils">Profils</Link></li>}
              {session.role === "ADMIN" && <li><Link href="/admin/comptes-en-attente">Comptes en attente</Link></li>}
            </ul>
          </nav>
          <main style={{ flex: 1, padding: 24 }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
