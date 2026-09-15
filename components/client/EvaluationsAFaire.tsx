"use client";

import { useState } from "react";
import { Card, Bouton } from "./primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : extrait tel quel de
// app/client/page.tsx (comportement et appel API identiques — POST
// /api/evaluations, inchangé), déplacé sur la page Missions (une évaluation
// porte toujours sur une mission précise).

export type MissionEvaluable = {
  id: string;
  repere: string | null;
  profil: { nom: string };
  evaluation: { note: number; commentaire: string | null } | null;
};

export default function EvaluationsAFaire({
  missions,
  recharger,
}: {
  missions: MissionEvaluable[];
  recharger: () => void;
}) {
  const aEvaluer = missions.filter((m) => !m.evaluation);
  if (aEvaluer.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {aEvaluer.map((m) => (
        <FormulaireEvaluation key={m.id} mission={m} recharger={recharger} />
      ))}
    </div>
  );
}

function FormulaireEvaluation({ mission, recharger }: { mission: MissionEvaluable; recharger: () => void }) {
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function envoyer() {
    if (note < 1) return;
    setEnvoi(true);
    await fetch("/api/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId: mission.id, note, commentaire }),
    });
    setEnvoi(false);
    recharger();
  }

  return (
    <Card>
      <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 14 }}>{mission.repere ?? mission.profil.nom}</p>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setNote(n)}
            style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", color: n <= note ? "#d97706" : "#ddd", padding: 0 }}
            aria-label={`${n} étoile(s)`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        placeholder="Commentaire (facultatif)"
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        rows={2}
        style={{ width: "100%", padding: 6, fontFamily: "inherit", marginBottom: 8 }}
      />
      <Bouton onClick={envoyer} disabled={note < 1 || envoi}>
        {envoi ? "..." : "Envoyer l'évaluation"}
      </Bouton>
    </Card>
  );
}
