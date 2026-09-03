"use client";

import { useEffect, useState } from "react";

type Mission = {
  id: string;
  repere: string | null;
  nbJours: number;
  statut: string;
  tjmVente?: number;
  margePct?: number | null;
  client: { nom: string };
  profil?: { nom: string };
};

const TEMPLATES = [
  { key: "contrat_prestation", label: "Contrat de prestation (client)" },
  { key: "nda", label: "Accord de confidentialité" },
  { key: "cdi", label: "CDI ingénieur" },
  { key: "freelance", label: "Contrat freelance" },
  { key: "portage", label: "Convention de portage" },
];

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
      <h1>Missions</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Client</th>
            <th>Repère</th>
            <th>Jours</th>
            <th>Statut</th>
            {isAdmin && <th>TJM vente</th>}
            {isAdmin && <th>Marge</th>}
            {isAdmin && <th>Générer</th>}
          </tr>
        </thead>
        <tbody>
          {missions.map((m) => (
            <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td>{m.client.nom}</td>
              <td>{m.repere ?? m.profil?.nom ?? "—"}</td>
              <td>{m.nbJours}</td>
              <td>{m.statut}</td>
              {isAdmin && <td>{m.tjmVente != null ? Math.round(m.tjmVente) + " €" : "—"}</td>}
              {isAdmin && <td>{m.margePct != null ? Math.round(m.margePct * 100) + " %" : "—"}</td>}
              {isAdmin && (
                <td>
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
    </div>
  );
}
