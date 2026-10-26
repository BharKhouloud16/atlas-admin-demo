"use client";

import { FormEvent, useEffect, useState } from "react";
import { bleu, bleuFonce, rouge } from "@/lib/theme";
import { STATUTS_MISSION_CLOSE } from "@/lib/feuilles-de-temps";

// Correction Admin d'une feuille de temps sur une mission close (route
// POST /api/feuilles-de-temps/correction : motif obligatoire, refus si une
// facture existe, trace dans le Journal, revalidation Client requise).
type MissionClose = { id: string; repere: string | null; statut: string; client: { nom: string }; profil: { nom: string; prenom?: string | null } };

export function CorrectionCra({ onCorrection }: { onCorrection: () => void }) {
  const [missions, setMissions] = useState<MissionClose[]>([]);
  const [missionId, setMissionId] = useState("");
  const [mois, setMois] = useState("");
  const [jours, setJours] = useState("");
  const [heuresSup, setHeuresSup] = useState("0");
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    fetch("/api/missions")
      .then((r) => (r.ok ? r.json() : []))
      .then((liste: MissionClose[]) => setMissions(liste.filter((m) => STATUTS_MISSION_CLOSE.includes(m.statut))))
      .catch(() => setMissions([]));
  }, []);

  async function corriger(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setRetour(null);
    const r = await fetch("/api/feuilles-de-temps/correction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, mois, joursTravailles: Number(jours), heuresSupplementaires: Number(heuresSup) || 0, motif }),
    });
    setEnvoi(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setRetour({ ok: false, texte: d.error ?? "La correction a échoué." });
      return;
    }
    setRetour({ ok: true, texte: "Feuille corrigée : elle attend maintenant la validation du client. La correction est tracée dans le Journal." });
    setMotif("");
    onCorrection();
  }

  if (missions.length === 0) return null;

  return (
    <form onSubmit={corriger} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 14, marginBottom: 24, maxWidth: 700 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: bleuFonce, margin: "0 0 4px" }}>Correction d&apos;une feuille de temps — mission close</p>
      <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px" }}>
        L&apos;ingénieur ne peut plus saisir sur une mission terminée ou annulée. Une correction exige un motif, est tracée, et doit être revalidée par le client. Impossible si une facture existe déjà.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12 }}>
          Mission
          <br />
          <select value={missionId} onChange={(e) => setMissionId(e.target.value)} required>
            <option value="">—</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.repere ?? m.client.nom} — {m.client.nom} ({m.statut})
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Mois
          <br />
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} required />
        </label>
        <label style={{ fontSize: 12 }}>
          Jours travaillés
          <br />
          <input type="number" min={0} max={31} step={0.5} value={jours} onChange={(e) => setJours(e.target.value)} required style={{ width: 80 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Heures sup.
          <br />
          <input type="number" min={0} step={0.5} value={heuresSup} onChange={(e) => setHeuresSup(e.target.value)} style={{ width: 80 }} />
        </label>
        <label style={{ fontSize: 12, flex: "1 1 220px" }}>
          Motif (10 caractères minimum)
          <br />
          <input value={motif} onChange={(e) => setMotif(e.target.value)} required minLength={10} style={{ width: "100%" }} />
        </label>
        <button type="submit" disabled={envoi} style={{ fontSize: 12, padding: "7px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          Corriger
        </button>
      </div>
      {retour && (
        <p role={retour.ok ? "status" : "alert"} style={{ fontSize: 12, color: retour.ok ? "#16a34a" : rouge, margin: "8px 0 0" }}>
          {retour.texte}
        </p>
      )}
    </form>
  );
}
