"use client";

import { useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";

// B14 — Étape 1 du mot de passe oublié (voir app/api/auth/mot-de-passe-oublie/route.ts).
// Même mise en page que /connexion et /inscription (LogoAtlas, palette lib/theme)
// pour rester cohérent visuellement avec le reste du parcours d'authentification.
export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [lienDemo, setLienDemo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/mot-de-passe-oublie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Une erreur est survenue.");
      return;
    }
    setEnvoye(true);
    setLienDemo(data.lienReinitialisationDemo ?? null);
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
        <p style={{ fontSize: 13, marginBottom: 18 }}>
          <Link href="/connexion" style={{ color: bleu, textDecoration: "none" }}>
            ← Retour à la connexion
          </Link>
        </p>

        {!envoye ? (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 4, color: bleuFonce }}>Mot de passe oublié</h1>
            <p style={{ fontSize: 13, color: grisTexte, marginTop: 0, marginBottom: 20 }}>
              Indiquez votre adresse email : nous vous envoyons un lien pour choisir un nouveau mot de passe.
            </p>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: "100%" }}
              />
              {error && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{error}</p>}
              <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
                {loading ? "Envoi..." : "Envoyer le lien de réinitialisation"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 4, color: bleuFonce }}>Email envoyé</h1>
            <p style={{ fontSize: 13, color: grisTexte, marginTop: 0, marginBottom: 12 }}>
              Si un compte existe avec cette adresse, un email contenant un lien de réinitialisation vient de lui
              être envoyé (valable 1 heure).
            </p>
            {lienDemo && (
              <p style={{ fontSize: 13, color: grisTexte, background: "#f4f7fe", padding: 12, borderRadius: 8 }}>
                Démo — aucun fournisseur d&apos;email n&apos;est branché sur ce site de test : cliquez ici pour
                simuler la réception de l&apos;email :{" "}
                <Link href={lienDemo} style={{ color: bleu }}>
                  réinitialiser mon mot de passe
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
