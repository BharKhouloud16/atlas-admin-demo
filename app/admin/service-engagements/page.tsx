"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";

// PHASE 7 — Service OS Foundation (22/09/2026). Liste Admin +
// création — même structure que app/admin/clients/page.tsx (formulaire
// repliable, table simple), volontairement minimal (mandat section 18 :
// pas de dashboard, pas de recherche avancée).

type ServiceEngagementListe = {
  id: string;
  titre: string;
  description: string | null;
  statut: string;
  createdAt: string;
  client: { id: string; nom: string };
};

type ClientOption = { id: string; nom: string };

const CHAMPS_VIDES = { clientId: "", titre: "", description: "" };

export default function ServiceEngagementsPage() {
  const [engagements, setEngagements] = useState<ServiceEngagementListe[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [chargement, setChargement] = useState(true);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [champs, setChamps] = useState(CHAMPS_VIDES);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  function charger() {
    fetch("/api/service-engagements")
      .then((r) => r.json())
      .then((data) => {
        setEngagements(Array.isArray(data) ? data : []);
        setChargement(false);
      });
  }
  useEffect(charger, []);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    if (!champs.clientId) {
      setErreur("Le client est requis.");
      return;
    }
    if (!champs.titre.trim()) {
      setErreur("Le titre est requis.");
      return;
    }
    setEnvoi(true);
    const res = await fetch("/api/service-engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...champs, description: champs.description || undefined }),
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
          <h1 style={{ marginBottom: 4, color: bleuFonce }}>Service OS</h1>
          <p style={{ fontSize: 13, color: grisTexte, margin: 0 }}>
            {engagements.length} prestation{engagements.length > 1 ? "s" : ""} ATLAS OS / Services.
          </p>
        </div>
        <button
          onClick={() => setFormulaireOuvert((v) => !v)}
          style={{ fontSize: 13, padding: "8px 14px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {formulaireOuvert ? "Annuler" : "+ Nouvelle prestation"}
        </button>
      </div>

      {formulaireOuvert && (
        <form
          onSubmit={creer}
          style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 640 }}
        >
          <select value={champs.clientId} onChange={(e) => setChamps({ ...champs, clientId: e.target.value })} required>
            <option value="">Client *</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
          <input placeholder="Titre *" value={champs.titre} onChange={(e) => setChamps({ ...champs, titre: e.target.value })} required />
          <textarea
            placeholder="Description"
            value={champs.description}
            onChange={(e) => setChamps({ ...champs, description: e.target.value })}
            style={{ gridColumn: "1 / -1", minHeight: 60 }}
          />
          {erreur && <p style={{ color: "crimson", fontSize: 13, gridColumn: "1 / -1", margin: 0 }}>{erreur}</p>}
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" disabled={envoi} style={{ fontSize: 13, padding: "8px 16px" }}>
              {envoi ? "Création..." : "Créer la prestation"}
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Prestation</th>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Créée le</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {engagements.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.titre}</td>
                <td style={{ padding: "6px 8px" }}>{e.client.nom}</td>
                <td style={{ padding: "6px 8px" }}>{e.statut}</td>
                <td style={{ padding: "6px 8px" }}>{new Date(e.createdAt).toLocaleDateString("fr-FR")}</td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/service-engagements/${e.id}`} style={{ fontSize: 13, color: bleu, textDecoration: "none" }}>
                    Ouvrir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {engagements.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>
            Aucune prestation Service OS pour l'instant — créez-en une avec le bouton ci-dessus.
          </p>
        )}
      </div>
    </div>
  );
}
