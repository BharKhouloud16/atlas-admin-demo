"use client";

import { useEffect, useState } from "react";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

type Mission = {
  id: string;
  repere: string | null;
  nbJours: number;
  statut: string;
  tjmVente?: number;
  ca?: number | null;
  margeEuros?: number | null;
  margePct?: number | null;
  client: { nom: string };
  profil?: { nom: string; prenom?: string | null };
};

const TEMPLATES = [
  { key: "contrat_prestation", label: "Contrat de prestation (client)" },
  { key: "nda", label: "Accord de confidentialité" },
  { key: "cdi", label: "CDI ingénieur" },
  { key: "freelance", label: "Contrat freelance" },
  { key: "portage", label: "Convention de portage" },
];

function nomIngenieur(p?: { nom: string; prenom?: string | null }): string {
  if (!p) return "—";
  return p.prenom ? `${p.prenom} ${p.nom}` : p.nom;
}

// Deux usages bien distincts sur cette page, volontairement séparés
// visuellement : (1) le suivi opérationnel et financier des missions
// (tableau ci-dessous — qui, chez qui, depuis quand, TJM, CA, marge), et
// (2) la génération de contrats (dernière colonne, une fois l'entretien de
// l'ingénieur validé) — le système de génération lui-même (docx) existe déjà
// et n'a pas été reconstruit, seul cet écran a été clarifié.
export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/missions")
      .then((r) => r.json())
      .then((data) => {
        setMissions(data);
        // un ingénieur ne reçoit pas de champ tjmVente : sert à adapter l'affichage
        setRole(data[0]?.tjmVente !== undefined ? "ADMIN" : "INGENIEUR");
      });
  }, []);

  async function generer(missionId: string, templateKey: string) {
    setGenerating(missionId + templateKey);
    const res = await fetch("/api/generate-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, templateKey }),
    });
    setGenerating(null);

    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Erreur de génération");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${templateKey}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isAdmin = role === "ADMIN";

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Missions</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20, maxWidth: 760 }}>
        Suivi opérationnel et financier de chaque mission (qui, chez quel client, TJM, CA et marge). La
        génération des contrats et avenants se fait mission par mission via la colonne « Générer », une fois
        l'entretien de l'ingénieur validé.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Ingénieur</th>
              <th style={{ padding: "6px 8px" }}>Repère</th>
              <th style={{ padding: "6px 8px" }}>Jours</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              {isAdmin && <th style={{ padding: "6px 8px" }}>TJM vente</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>CA prévisionnel</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Marge €</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Marge %</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Générer un contrat</th>}
            </tr>
          </thead>
          <tbody>
            {missions.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{m.client.nom}</td>
                <td style={{ padding: "6px 8px" }}>{nomIngenieur(m.profil)}</td>
                <td style={{ padding: "6px 8px" }}>{m.repere ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{m.nbJours}</td>
                <td style={{ padding: "6px 8px" }}>{m.statut}</td>
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.tjmVente != null ? Math.round(m.tjmVente) + " €" : "—"}</td>}
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.ca != null ? Math.round(m.ca).toLocaleString("fr-FR") + " €" : "—"}</td>}
                {isAdmin && (
                  <td style={{ padding: "6px 8px", color: m.margeEuros != null && m.margeEuros < 0 ? "#b91c1c" : undefined }}>
                    {m.margeEuros != null ? Math.round(m.margeEuros).toLocaleString("fr-FR") + " €" : "—"}
                  </td>
                )}
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.margePct != null ? Math.round(m.margePct * 100) + " %" : "—"}</td>}
                {isAdmin && (
                  <td style={{ padding: "6px 8px" }}>
                    <select
                      onChange={(e) => {
                        if (e.target.value) generer(m.id, e.target.value);
                        e.target.value = "";
                      }}
                      disabled={generating?.startsWith(m.id)}
                    >
                      <option value="">Choisir un contrat...</option>
                      {TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {missions.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucune mission pour l'instant.</p>
        )}
      </div>
    </div>
  );
}
