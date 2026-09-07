"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Etat = "chargement" | "ok" | "erreur";

export default function VerifierEmailPage() {
  const [etat, setEtat] = useState<Etat>("chargement");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setEtat("erreur");
      setMessage("Lien de vérification manquant.");
      return;
    }
    fetch("/api/auth/verifier-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setEtat("erreur");
          setMessage(data.error ?? "Lien de vérification invalide.");
          return;
        }
        setEtat("ok");
      })
      .catch(() => {
        setEtat("erreur");
        setMessage("Une erreur est survenue. Réessayez.");
      });
  }, []);

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Atlas Quality Partners</h1>

      {etat === "chargement" && <p style={{ fontSize: 14, color: "#4b5567" }}>Vérification en cours...</p>}

      {etat === "ok" && (
        <>
          <p style={{ fontSize: 14, color: "#16a34a", fontWeight: 600 }}>✓ Votre adresse email est confirmée.</p>
          <p style={{ fontSize: 13, color: "#4b5567", marginTop: 8 }}>
            Vous pouvez maintenant vous connecter — sous réserve, si votre compte vient d&apos;être créé, de sa
            validation par l&apos;administrateur.
          </p>
          <Link href="/connexion" style={{ display: "inline-block", marginTop: 20, fontSize: 13, color: "#2557d6" }}>
            Aller à la connexion
          </Link>
        </>
      )}

      {etat === "erreur" && (
        <>
          <p style={{ fontSize: 14, color: "crimson" }}>{message}</p>
          <p style={{ fontSize: 13, color: "#4b5567", marginTop: 8 }}>
            <Link href="/connexion" style={{ color: "#2557d6" }}>Retour à la connexion</Link>
          </p>
        </>
      )}
    </main>
  );
}
