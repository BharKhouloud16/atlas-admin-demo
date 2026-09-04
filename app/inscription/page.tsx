"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";

const FORMES_JURIDIQUES = ["SARL", "SA", "SAS", "EURL", "Auto-entrepreneur", "Autre"];

export default function InscriptionPage() {
  const router = useRouter();
  const [role, setRole] = useState<"INGENIEUR" | "CLIENT">("CLIENT");
  const [roleImpose, setRoleImpose] = useState(false); // true si on arrive via ?role=... (boutons de la page d'accueil)

  // Champs communs
  const [nom, setNom] = useState(""); // nom de famille (ingénieur) ou raison sociale (partenaire)
  const [prenom, setPrenom] = useState(""); // prénom (ingénieur uniquement)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Champs spécifiques Espace Partenaire (CLIENT)
  const [identifiantEntreprise, setIdentifiantEntreprise] = useState(""); // RC / RNE selon le pays
  const [formeJuridique, setFormeJuridique] = useState("");
  const [contactReferent, setContactReferent] = useState("");
  const [telephone, setTelephone] = useState("");

  const [consentementRgpd, setConsentementRgpd] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lienVerificationDemo, setLienVerificationDemo] = useState("");

  // Pré-sélectionne le rôle si on arrive depuis un bouton "Espace Ingénieur" /
  // "Espace Partenaire" de la page d'accueil ou de la connexion (?role=...).
  // Dans ce cas, le choix client/ingénieur n'est plus affiché : il est déjà connu.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("role");
    if (param === "ingenieur") {
      setRole("INGENIEUR");
      setRoleImpose(true);
    } else if (param === "client") {
      setRole("CLIENT");
      setRoleImpose(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (role === "CLIENT" && !telephone) {
      setError("Le numéro de téléphone est requis.");
      return;
    }
    if (role === "INGENIEUR" && !prenom) {
      setError("Le prénom est requis.");
      return;
    }
    if (!consentementRgpd) {
      setError("Merci d'accepter le traitement de vos données pour continuer.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        role,
        nom,
        consentementRgpd,
        ...(role === "CLIENT"
          ? { identifiantEntreprise, formeJuridique, contactReferent, telephone }
          : { prenom }),
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'inscription.");
      return;
    }
    setLienVerificationDemo(data.lienVerificationDemo ?? "");
    setDone(true);
  }

  if (done) {
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
            maxWidth: 420,
            background: "#fff",
            border: `1px solid ${bordure}`,
            borderRadius: 12,
            padding: 32,
            boxShadow: "0 2px 12px rgba(18,34,74,0.06)",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12, color: bleuFonce }}>Compte créé</h1>
          <p style={{ color: grisTexte, fontSize: 14, lineHeight: 1.6 }}>
            Un email de confirmation vous a été envoyé : cliquez sur le lien qu&apos;il contient pour valider votre
            adresse. Votre compte sera ensuite en attente de validation par l&apos;administrateur, qui vous
            préviendra par email dès que votre accès sera activé.
          </p>
          {lienVerificationDemo && (
            <p style={{ fontSize: 12, color: "#888", background: "#f6f7fa", padding: 10, borderRadius: 8, marginTop: 12 }}>
              Démo — aucun fournisseur d&apos;email n&apos;est branché sur ce site de test : cliquez ici pour simuler
              la réception de l&apos;email de confirmation :{" "}
              <a href={lienVerificationDemo} style={{ color: bleu }}>
                confirmer mon adresse email
              </a>
            </p>
          )}
          <button onClick={() => router.push("/connexion")} style={{ marginTop: 16, width: "100%" }}>
            Retour à la connexion
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 24px",
        background: "linear-gradient(180deg,#f4f7fe 0%,#ffffff 100%)",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <LogoAtlas />
      </div>
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          border: `1px solid ${bordure}`,
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 2px 12px rgba(18,34,74,0.06)",
        }}
      >
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        <Link href="/" style={{ color: bleu, textDecoration: "none" }}>
          ← Retour à l&apos;accueil
        </Link>
      </p>
      <h1 style={{ fontSize: 20, marginBottom: 4, color: bleuFonce }}>Créer un compte</h1>
      <p style={{ fontSize: 14, color: grisTexte, marginTop: 0, marginBottom: 24 }}>
        {role === "CLIENT" ? "Espace Partenaire" : "Espace Ingénieur"}
      </p>

      {!roleImpose && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setRole("CLIENT")}
            style={{
              flex: 1,
              background: role === "CLIENT" ? bleu : "#fff",
              color: role === "CLIENT" ? "#fff" : bleuFonce,
              border: `1px solid ${role === "CLIENT" ? bleu : bordure}`,
            }}
          >
            Je suis client
          </button>
          <button
            type="button"
            onClick={() => setRole("INGENIEUR")}
            style={{
              flex: 1,
              background: role === "INGENIEUR" ? bleu : "#fff",
              color: role === "INGENIEUR" ? "#fff" : bleuFonce,
              border: `1px solid ${role === "INGENIEUR" ? bleu : bordure}`,
            }}
          >
            Je suis ingénieur
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {role === "CLIENT" ? (
          <input
            placeholder="Raison sociale"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            required
          />
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Prénom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <input
              placeholder="Nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
              style={{ flex: 1 }}
            />
          </div>
        )}

        {role === "CLIENT" && (
          <>
            <input
              placeholder="Identifiant entreprise (RC / RNE)"
              value={identifiantEntreprise}
              onChange={(e) => setIdentifiantEntreprise(e.target.value)}
            />
            <select value={formeJuridique} onChange={(e) => setFormeJuridique(e.target.value)}>
              <option value="">Forme juridique</option>
              {FORMES_JURIDIQUES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input
              placeholder="Nom du contact principal"
              value={contactReferent}
              onChange={(e) => setContactReferent(e.target.value)}
              required
            />
            <input
              type="tel"
              placeholder="Numéro de téléphone"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              required
            />
          </>
        )}

        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Mot de passe (8 caractères min.)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input type="password" placeholder="Confirmer le mot de passe" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required />

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#4b5567" }}>
          <input
            type="checkbox"
            checked={consentementRgpd}
            onChange={(e) => setConsentementRgpd(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            J&apos;accepte que mes données soient traitées par Atlas Quality Partners pour être mis(e) en relation
            avec des missions, conformément à la{" "}
            <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: "#2557d6" }}>
              politique de confidentialité
            </a>{" "}
            (RGPD).
          </span>
        </label>

        {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
          {loading ? "Création..." : "Créer mon compte"}
        </button>
      </form>

      <p style={{ fontSize: 12, color: "#888", marginTop: 16 }}>
        Votre compte sera actif après validation par l&apos;administrateur.
        {role === "INGENIEUR" && " Vous pourrez ensuite importer votre CV."}
      </p>
      </div>
    </main>
  );
}
