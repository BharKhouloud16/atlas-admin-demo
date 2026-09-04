"use client";

import { useEffect, useState } from "react";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";

type Client = {
  id: string;
  nom: string;
  pays: string | null;
  secteur: string | null;
  contactReferent: string | null;
  email: string | null;
  telephone: string | null;
  formeJuridique: string | null;
  createdAt: string;
};

const CHAMPS_VIDES = { nom: "", pays: "", secteur: "", contactReferent: "", email: "", telephone: "" };

// Cette page manquait complètement (le lien de nav "Clients" pointait vers
// une route jamais créée, d'où l'erreur 404) alors que /api/clients existait
// déjà. Liste les clients + formulaire de création rapide.
export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [chargement, setChargement] = useState(true);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [champs, setChamps] = useState(CHAMPS_VIDES);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  function charger() {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => {
        setClients(Array.isArray(data) ? data : []);
        setChargement(false);
      });
  }
  useEffect(charger, []);

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    if (!champs.nom.trim()) {
      setErreur("Le nom du client est requis.");
      return;
    }
    setEnvoi(true);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(champs),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    setChamps(CHAMPS_VIDES);
    setFormulaireOuvert(false);
    charger();
  }

  if (chargement) return <div>Chargement...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ marginBottom: 4, color: bleuFonce }}>Clients</h1>
          <p style={{ fontSize: 13, color: grisTexte, margin: 0 }}>
            {clients.length} client{clients.length > 1 ? "s" : ""} enregistré{clients.length > 1 ? "s" : ""}.
          </p>
        </div>
        <button
          onClick={() => setFormulaireOuvert((v) => !v)}
          style={{ fontSize: 13, padding: "8px 14px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {formulaireOuvert ? "Annuler" : "+ Nouveau client"}
        </button>
      </div>

      {formulaireOuvert && (
        <form
          onSubmit={creer}
          style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 640 }}
        >
          <input
            placeholder="Raison sociale *"
            value={champs.nom}
            onChange={(e) => setChamps({ ...champs, nom: e.target.value })}
            required
          />
          <input
            placeholder="Pays"
            value={champs.pays}
            onChange={(e) => setChamps({ ...champs, pays: e.target.value })}
          />
          <input
            placeholder="Secteur d'activité"
            value={champs.secteur}
            onChange={(e) => setChamps({ ...champs, secteur: e.target.value })}
          />
          <input
            placeholder="Contact référent"
            value={champs.contactReferent}
            onChange={(e) => setChamps({ ...champs, contactReferent: e.target.value })}
          />
          <input
            type="email"
            placeholder="Email"
            value={champs.email}
            onChange={(e) => setChamps({ ...champs, email: e.target.value })}
          />
          <input
            placeholder="Téléphone"
            value={champs.telephone}
            onChange={(e) => setChamps({ ...champs, telephone: e.target.value })}
          />
          {erreur && <p style={{ color: "crimson", fontSize: 13, gridColumn: "1 / -1", margin: 0 }}>{erreur}</p>}
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" disabled={envoi} style={{ fontSize: 13, padding: "8px 16px" }}>
              {envoi ? "Création..." : "Créer le client"}
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Pays</th>
              <th style={{ padding: "6px 8px" }}>Secteur</th>
              <th style={{ padding: "6px 8px" }}>Contact</th>
              <th style={{ padding: "6px 8px" }}>Email</th>
              <th style={{ padding: "6px 8px" }}>Téléphone</th>
              <th style={{ padding: "6px 8px" }}>Client depuis</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.nom}</td>
                <td style={{ padding: "6px 8px" }}>{c.pays ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{c.secteur ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{c.contactReferent ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{c.email ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{c.telephone ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{new Date(c.createdAt).toLocaleDateString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {clients.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>
            Aucun client pour l'instant — créez-en un avec le bouton ci-dessus.
          </p>
        )}
      </div>
    </div>
  );
}
