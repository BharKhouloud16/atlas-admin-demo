"use client";

import { useEffect, useState } from "react";

type EntreeJournal = {
  id: string;
  acteurEmail: string;
  acteurRole: string;
  action: string;
  cible: string | null;
  detail: string | null;
  createdAt: string;
};

const LABEL_ACTION: Record<string, string> = {
  validation_compte: "Validation de compte",
  creation_profil: "Création de profil",
  rejet_cra: "Rejet de feuille de temps",
};

export default function JournalActivitePage() {
  const [entrees, setEntrees] = useState<EntreeJournal[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    fetch("/api/journal")
      .then((r) => r.json())
      .then((d) => setEntrees(d.entrees ?? []))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div>
      <h1>Journal d&apos;activité</h1>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
        Trace des actions administratives sensibles (validation de compte, création de profil avec son TJM initial,
        rejet de feuille de temps) — les 200 dernières entrées.
      </p>

      {chargement && <p style={{ color: "#888" }}>Chargement...</p>}
      {!chargement && entrees.length === 0 && <p style={{ color: "#888" }}>Aucune activité enregistrée pour l&apos;instant.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entrees.map((e) => (
          <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{LABEL_ACTION[e.action] ?? e.action}</p>
              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>
                {new Date(e.createdAt).toLocaleString("fr-FR")}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5567" }}>{e.detail}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#aaa" }}>
              Par {e.acteurEmail} ({e.acteurRole})
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
