"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InscriptionPage() {
  const router = useRouter();
  const [role, setRole] = useState<"INGENIEUR" | "CLIENT">("CLIENT");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role, nom }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'inscription.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Compte créé</h1>
        <p>Votre compte est en attente de validation par l'administrateur. Vous recevrez un accès dès qu'il sera activé.</p>
        <button onClick={() => router.push("/connexion")} style={{ marginTop: 16 }}>Retour à la connexion</button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>Créer un compte</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={() => setRole("CLIENT")} style={{ fontWeight: role === "CLIENT" ? 700 : 400 }}>
          Je suis client
        </button>
        <button type="button" onClick={() => setRole("INGENIEUR")} style={{ fontWeight: role === "INGENIEUR" ? 700 : 400 }}>
          Je suis ingénieur
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          placeholder={role === "CLIENT" ? "Nom de l'entreprise" : "Nom et prénom"}
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          required
        />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Mot de passe (8 caractères min.)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Création..." : "Créer mon compte"}</button>
      </form>

      <p style={{ fontSize: 12, color: "#888", marginTop: 16 }}>
        Votre compte sera actif après validation par l'administrateur.
        {role === "INGENIEUR" && " Le type de contrat et le tarif seront fixés à ce moment-là, selon ce qui aura été convenu avec vous."}
      </p>
    </main>
  );
}
