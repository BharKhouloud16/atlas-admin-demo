"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";

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
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "linear-gradient(180deg,#f4f7fe 0%,#ffffff 100%)",
      }}
    >
      <div style={{ marginBottom: 28 }}>
        <LogoAtlas />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          border: `1px solid ${bordure}`,
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 2px 12px rgba(18,34,74,0.06)",
        }}
      >
        <p style={{ fontSize: 13, marginBottom: 18 }}>
          <Link href="/" style={{ color: bleu, textDecoration: "none" }}>
            ← Retour à l&apos;accueil
          </Link>
        </p>
        <h1 style={{ fontSize: 20, marginBottom: 4, color: bleuFonce }}>
          {contexte ? contexte.titre : "Connexion"}
        </h1>
        {contexte && (
          <p style={{ fontSize: 13, color: grisTexte, marginTop: 0, marginBottom: 20 }}>{contexte.sousTitre}</p>
        )}
        {!contexte && <p style={{ fontSize: 13, color: grisTexte, marginTop: 0, marginBottom: 20 }}>Accédez à votre espace.</p>}

        {info && (
          <p style={{ fontSize: 13, color: "#16a34a", background: "#eafaf0", padding: 10, borderRadius: 8, marginBottom: 16 }}>
            {info}
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: "100%" }}
          />
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: "100%" }}
          />
          {error && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <p style={{ fontSize: 13, marginTop: 20, marginBottom: 0, color: grisTexte }}>
          Ingénieur ou client, pas encore de compte ?{" "}
          <Link href={role ? `/inscription?role=${role}` : "/inscription"} style={{ color: bleu }}>
            S&apos;inscrire
          </Link>
        </p>
      </div>
    </main>
  );
}
