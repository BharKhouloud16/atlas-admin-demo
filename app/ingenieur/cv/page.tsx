"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ImporterCVPage() {
  const router = useRouter();
  const [fichier, setFichier] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!fichier) {
      setError("Sélectionnez un fichier (PDF ou Word).");
      return;
    }

    setLoading(true);
    const form = new FormData();
    form.append("cv", fichier);

    const res = await fetch("/api/ingenieur/cv", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Échec de l'import.");
      return;
    }
    router.push("/ingenieur/cv/verifier");
  }

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Importer votre CV</h1>
      <p style={{ fontSize: 14, color: "#4b5567", marginBottom: 24 }}>
        Dernière étape avant d&apos;accéder à votre espace : importez votre CV (PDF ou Word).
        Vous pourrez ensuite vérifier et valider les informations extraites, une par une.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input
          type="file"
          accept=".pdf,.doc,.docx"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}
        />
        {error && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: "10px 16px" }}>
          {loading ? "Import en cours..." : "Importer et continuer"}
        </button>
      </form>
    </main>
  );
}
