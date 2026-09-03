"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type InfoCV = {
  id: string;
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
  valide: boolean;
};

export default function VerifierCVPage() {
  const router = useRouter();
  const [infos, setInfos] = useState<InfoCV[] | null>(null);
  const [index, setIndex] = useState(0);
  const [valeur, setValeur] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/ingenieur/cv/infos")
      .then((r) => r.json())
      .then((data: InfoCV[]) => {
        setInfos(data);
        const premierNonValide = data.findIndex((i) => !i.valide);
        const depart = premierNonValide === -1 ? data.length : premierNonValide;
        setIndex(depart);
        setValeur(data[depart]?.valeur ?? "");
      });
  }, []);

  if (!infos) {
    return <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>Chargement...</main>;
  }

  if (infos.length === 0) {
    return (
      <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
        <p>Aucun CV importé.</p>
        <button onClick={() => router.push("/ingenieur/cv")}>Importer mon CV</button>
      </main>
    );
  }

  const termine = index >= infos.length;
  const courant = infos[index];

  async function valider() {
    if (!courant) return;
    setError("");
    setLoading(true);
    const res = await fetch("/api/ingenieur/cv/infos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: courant.id, valeur, valide: true }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Erreur.");
      return;
    }

    const suivant = index + 1;
    setIndex(suivant);
    setValeur(infos?.[suivant]?.valeur ?? "");
  }

  async function finaliser() {
    setError("");
    setLoading(true);
    const res = await fetch("/api/ingenieur/cv/finaliser", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erreur.");
      return;
    }
    router.push("/admin");
  }

  if (termine) {
    return (
      <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Toutes les informations sont validées</h1>
        <p style={{ fontSize: 14, color: "#4b5567", marginBottom: 24 }}>
          Merci ! Vos informations vont être analysées pour préparer votre profil (points forts,
          séniorité, missions envisageables).
        </p>
        {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}
        <button onClick={finaliser} disabled={loading} style={{ padding: "10px 16px" }}>
          {loading ? "Finalisation..." : "Terminer et accéder à mon espace"}
        </button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Vérification du CV</h1>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
        Information {index + 1} / {infos.length}
      </p>

      <div style={{ border: "1px solid #e4e7ee", borderRadius: 10, padding: 20 }}>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", margin: "0 0 4px" }}>
          {courant.categorie}
        </p>
        <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
          {courant.libelle}
        </label>
        <textarea
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          placeholder="Saisissez ou corrigez cette information..."
          rows={3}
          style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit" }}
        />
        {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            onClick={valider}
            disabled={loading}
            title="Valider cette information"
            style={{ padding: "6px 18px", fontWeight: 600 }}
          >
            OK
          </button>
        </div>
      </div>
    </main>
  );
}
