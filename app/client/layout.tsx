import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT") {
    redirect("/connexion");
  }

  return (
    <>
      <header style={{ borderBottom: "1px solid #e5e5e5", padding: "16px 24px" }}>
        <p style={{ fontWeight: 600, margin: 0 }}>Espace client — Atlas Quality Partners</p>
      </header>
      <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>{children}</main>
    </>
  );
}
