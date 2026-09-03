"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// v1.2 : connexion pré-filtrée par rôle. La page reste un point d'entrée
// unique (même mécanisme d'authentification /api/auth/login, le rôle réel
// est toujours celui enregistré en base) — le paramètre ?role= ne sert qu'à
// adapter le titre/contexte affiché selon le bouton cliqué sur la page d'accueil
// (Espace Ingénieur / Espace Partenaire / Connexion générale).
type Role = "ingenieur" | "client" | null;

const CONTEXTES: Record<string, { titre: string; sousTitre: string }> = {
  ingenieur: {
    titre: "Espace Ingénieur",
    sousTitre: "Connectez-vous pour suivre vos missions en cours.",
  },
  client: {
    titre: "Espace Partenaire",
    sousTitre: "Connectez-vous pour suivre vos missions et vos livrables.",
  },
};

export default function ConnexionPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("role");
    if (param === "ingenieur" || param === "client") setRole(param);
    if (params.get("desactive") === "1") {
      setInfo("Votre compte a bien été désactivé. Reconnectez-vous à tout moment pour le réactiver.");
    } else if (params.get("supprime") === "1") {
      setInfo("Votre profil a bien été supprimé définitivement.");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Identifiants invalides.");
      return;
    }
    router.push(data.redirect ?? "/admin");
  }

  const contexte = role ? CONTEXTES[role] : null;

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <p style={{ fontSize: 13, marginBottom: 4 }}>
        <Link href="/" style={{ color: "#2557d6", textDecoration: "none" }}>← Retour à l&apos;accueil</Link>
      </p>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Atlas Quality Partners</h1>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#4b5567", marginTop: 0, marginBottom: 24 }}>
        {contexte ? contexte.titre : "Connexion"}
      </h2>
      {contexte && (
        <p style={{ fontSize: 13, color: "#4b5567", marginTop: -16, marginBottom: 20 }}>{contexte.sousTitre}</p>
      )}
      {info && (
        <p style={{ fontSize: 13, color: "#16a34a", background: "#eafaf0", padding: 10, borderRadius: 6, marginTop: -8, marginBottom: 16 }}>
          {info}
        </p>
      )}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Connexion..." : "Se connecter"}</button>
      </form>
      <p style={{ fontSize: 13, marginTop: 16 }}>
        Ingénieur ou client, pas encore de compte ?{" "}
        <Link href={role ? `/inscription?role=${role}` : "/inscription"}>S&apos;inscrire</Link>
      </p>
    </main>
  );
}
