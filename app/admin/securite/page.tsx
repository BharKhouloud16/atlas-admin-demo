"use client";

import { useState } from "react";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

// Configuration du 2FA (TOTP) pour le compte Admin connecté — voir
// app/api/auth/2fa/* et lib/totp.ts. Réservé à l'Admin (comme le reste de
// /admin), sur son propre compte uniquement : pas d'écran pour activer le
// 2FA d'un autre compte.
export default function SecuritePage() {
  const [etape, setEtape] = useState<"repos" | "configuration" | "codesSecours">("repos");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [codesSecours, setCodesSecours] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const [motDePasseDesactivation, setMotDePasseDesactivation] = useState("");
  const [erreurDesactivation, setErreurDesactivation] = useState("");
  const [confirmationDesactivation, setConfirmationDesactivation] = useState(false);

  async function demarrerConfiguration() {
    setErreur("");
    setChargement(true);
    const reponse = await fetch("/api/auth/2fa/setup", { method: "POST" });
    const data = await reponse.json();
    setChargement(false);
    if (!reponse.ok) {
      setErreur(data.error ?? "Erreur lors de la génération du secret.");
      return;
    }
    setQrCode(data.qrCode);
    setSecret(data.secret);
    setEtape("configuration");
  }

  async function confirmerCode(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setChargement(true);
    const reponse = await fetch("/api/auth/2fa/verifier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await reponse.json();
    setChargement(false);
    if (!reponse.ok) {
      setErreur(data.error ?? "Code invalide.");
      return;
    }
    setCodesSecours(data.codesSecours);
    setEtape("codesSecours");
  }

  async function desactiver(e: React.FormEvent) {
    e.preventDefault();
    setErreurDesactivation("");
    const reponse = await fetch("/api/auth/2fa/desactiver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motDePasse: motDePasseDesactivation }),
    });
    const data = await reponse.json();
    if (!reponse.ok) {
      setErreurDesactivation(data.error ?? "Erreur.");
      return;
    }
    setEtape("repos");
    setMotDePasseDesactivation("");
    setConfirmationDesactivation(false);
    window.location.reload(); // pour refléter le nouvel état côté serveur
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Sécurité de mon compte</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 24 }}>
        Authentification à deux facteurs (2FA) — recommandée pour un compte Administrateur, qui a accès aux coûts et
        marges internes de la plateforme.
      </p>

      {etape === "repos" && (
        <div style={{ border: `1px solid ${bordure}`, borderRadius: 10, padding: 20 }}>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Ajoutez une vérification par code à 6 chiffres (application d&apos;authentification type Google
            Authenticator ou Authy) à chaque connexion.
          </p>
          <button onClick={demarrerConfiguration} disabled={chargement}>
            {chargement ? "..." : "Activer le 2FA"}
          </button>
          {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}

          <hr style={{ margin: "20px 0", border: "none", borderTop: `1px solid ${bordure}` }} />
          <p style={{ fontSize: 13, color: grisTexte, marginBottom: 8 }}>2FA déjà actif ? Désactivez-le ici (mot de passe requis) :</p>
          <form onSubmit={desactiver} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="password"
              placeholder="Mot de passe actuel"
              value={motDePasseDesactivation}
              onChange={(e) => setMotDePasseDesactivation(e.target.value)}
            />
            <label style={{ fontSize: 12, color: grisTexte, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={confirmationDesactivation} onChange={(e) => setConfirmationDesactivation(e.target.checked)} />
              Je confirme vouloir désactiver le 2FA sur ce compte.
            </label>
            <button type="submit" disabled={!motDePasseDesactivation || !confirmationDesactivation} style={{ alignSelf: "flex-start" }}>
              Désactiver le 2FA
            </button>
            {erreurDesactivation && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{erreurDesactivation}</p>}
          </form>
        </div>
      )}

      {etape === "configuration" && (
        <div style={{ border: `1px solid ${bordure}`, borderRadius: 10, padding: 20 }}>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            1. Scannez ce QR code avec votre application d&apos;authentification.
          </p>
          {qrCode && <img src={qrCode} alt="QR code 2FA" style={{ width: 200, height: 200 }} />}
          <p style={{ fontSize: 12, color: "#888" }}>
            Ou saisissez manuellement la clé : <code>{secret}</code>
          </p>
          <p style={{ fontSize: 13 }}>2. Saisissez le code affiché par l&apos;application pour confirmer :</p>
          <form onSubmit={confirmerCode} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
            <button type="submit" disabled={chargement}>
              {chargement ? "..." : "Confirmer"}
            </button>
          </form>
          {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}
        </div>
      )}

      {etape === "codesSecours" && (
        <div style={{ border: "1px solid #16a34a", background: "#eafaf0", borderRadius: 10, padding: 20 }}>
          <p style={{ fontWeight: 600, color: bleuFonce, marginTop: 0 }}>2FA activé ✓</p>
          <p style={{ fontSize: 13 }}>
            Conservez ces codes de secours dans un endroit sûr (gestionnaire de mots de passe...) — ils ne seront plus
            jamais affichés, et permettent de vous connecter si vous perdez l&apos;accès à votre application
            d&apos;authentification. Chaque code n&apos;est utilisable qu&apos;une seule fois.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: "monospace", fontSize: 13, background: "#fff", padding: 12, borderRadius: 8 }}>
            {codesSecours.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
