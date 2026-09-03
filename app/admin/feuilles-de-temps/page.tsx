"use client";

import { useEffect, useState } from "react";
import { bleu, bleuFonce } from "@/lib/theme";
import { LABEL_STATUT_CRA, COULEUR_STATUT_CRA, libelleMois, type StatutCra } from "@/lib/feuilles-de-temps";

type Feuille = {
  id: string;
  mois: string;
  joursTravailles: number;
  heuresSupplementaires: number;
  commentaire: string | null;
  statut: StatutCra;
  motifRejet: string | null;
  mission: {
    repere: string | null;
    client: { nom: string };
    profil: { nom: string };
  };
};

// File de validation Admin des feuilles de temps (CRA) — deuxième étape du
// circuit après soumission par l'ingénieur, avant la validation finale du
// client (voir /client et app/api/feuilles-de-temps). Façon BoondManager :
// l'Admin est le premier filtre avant que le client ne voie quoi que ce soit.
export default function FeuillesDeTempsAdminPage() {
  const [feuilles, setFeuilles] = useState<Feuille[]>([]);
  const [chargement, setChargement] = useState(true);
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState<string | null>(null);

  function recharger() {
    fetch("/api/feuilles-de-temps")
      .then((r) => r.json())
      .then((data) => {
        setFeuilles(data.feuilles ?? []);
        setChargement(false);
      });
  }
  useEffect(recharger, []);

  async function agir(id: string, action: "validerAdmin" | "rejeter") {
    setEnvoi(id + action);
    await fetch("/api/feuilles-de-temps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, motifRejet: motifs[id] }),
    });
    setEnvoi(null);
    recharger();
  }

  if (chargement) return <div>Chargement...</div>;

  const enAttente = feuilles.filter((f) => f.statut === "Soumise");
  const autres = feuilles.filter((f) => f.statut !== "Soumise");

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Feuilles de temps</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 24, maxWidth: 700 }}>
        Compte-rendu d&apos;activité (CRA) mensuel déclaré par chaque ingénieur pour ses missions en cours. Votre
        validation est la première étape avant celle du client, indispensable à la facturation.
      </p>

      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        En attente de votre validation ({enAttente.length})
      </p>
      {enAttente.length === 0 && <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Rien à valider pour l&apos;instant.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
        {enAttente.map((f) => (
          <div key={f.id} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                  {f.mission.profil.nom} — {f.mission.repere ?? f.mission.client.nom} ({f.mission.client.nom})
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5567" }}>
                  {libelleMois(f.mois)} · {f.joursTravailles} j
                  {f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
                </p>
                {f.commentaire && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>« {f.commentaire} »</p>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => agir(f.id, "validerAdmin")}
                    disabled={envoi === f.id + "validerAdmin"}
                    style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    Valider
                  </button>
                  <button
                    onClick={() => agir(f.id, "rejeter")}
                    disabled={envoi === f.id + "rejeter"}
                    style={{ fontSize: 12, padding: "6px 12px", color: "#b3261e", borderColor: "#b3261e" }}
                  >
                    Rejeter
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Motif si rejet"
                  value={motifs[f.id] ?? ""}
                  onChange={(e) => setMotifs((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #e4e7ee", borderRadius: 4, width: 180 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Historique</p>
      {autres.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune autre feuille de temps.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {autres.map((f) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
            <span>
              {f.mission.profil.nom} — {libelleMois(f.mois)} · {f.joursTravailles} j
              {f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: COULEUR_STATUT_CRA[f.statut] }}>
              {LABEL_STATUT_CRA[f.statut]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
