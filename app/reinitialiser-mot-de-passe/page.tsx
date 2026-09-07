"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";

// B14 — Étape 2 du mot de passe oublié (voir app/api/auth/reinitialiser-mot-de-passe/route.ts).
// Le token est lu directement dans l'URL (comme app/verifier-email/page.tsx)
// plutôt que via useSearchParams, pour éviter toute contrainte de Suspense
// boundary côté build — même convention que la page de vérification email.
type Etat = "formulaire" | "ok" | "erreur";

export default function ReinitialiserMotDePassePage() {
  const [token, setToken] = useState<string | null>(null);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [etat, setEtat] = useState<Etat>("formulaire");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (!t) {
      setEtat("erreur");
      setMessage("Lien de réinitialisation manquant.");
      return;
    }
    setToken(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMessage("");
    setLoading(true);
    const res = await fetch("/api/auth/reinitialiser-mot-de-passe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, nouveauMotDePasse, confirmationNouveauMotDePasse: confirmation }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(data.error ?? "Une erreur est survenue.");
      return;
    }
    setEtat("ok");
  }

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
        {etat === "formulaire" && token && (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 4, color: bleuFonce }}>Nouveau mot de passe</h1>
            <p style={{ fontSize: 13, color: grisTexte, marginTop: 0, marginBottom: 20 }}>
              Choisissez un nouveau mot de passe (8 caractères minimum).
            </p>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="password"
                placeholder="Nouveau mot de passe"
                value={nouveauMotDePasse}
                onChange={(e) => setNouveauMotDePasse(e.target.value)}
                required
                style={{ width: "100%" }}
              />
              <input
                type="password"
                placeholder="Confirmer le mot de passe"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
                style={{ width: "100%" }}
              />
              {message && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{message}</p>}
              <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
                {loading ? "Enregistrement..." : "Réinitialiser mon mot de passe"}
              </button>
            </form>
          </>
        )}

        {etat === "ok" && (
          <>
            <p style={{ fontSize: 14, color: "#16a34a", fontWeight: 600, margin: 0 }}>
              ✓ Votre mot de passe a été réinitialisé.
            </p>
            <p style={{ fontSize: 13, color: grisTexte, marginTop: 8 }}>
              Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <Link href="/connexion" style={{ display: "inline-block", marginTop: 12, fontSize: 13, color: bleu }}>
              Aller à la connexion
            </Link>
          </>
        )}

        {etat === "erreur" && (
          <>
            <p style={{ fontSize: 14, color: "crimson", margin: 0 }}>{message}</p>
            <p style={{ fontSize: 13, color: grisTexte, marginTop: 8 }}>
              <Link href="/mot-de-passe-oublie" style={{ color: bleu }}>
                Demander un nouveau lien
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
