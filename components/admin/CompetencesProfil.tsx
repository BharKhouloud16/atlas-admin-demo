"use client";

import { useEffect, useState } from "react";
import { bleu, bleuFonce, rouge } from "@/lib/theme";

// Compétences d'un profil (Skill Graph) côté Admin : structuration depuis les
// déclarations de l'ingénieur et le CV validé, puis vérification une à une.
// Seules les compétences VÉRIFIÉES couvrent un besoin côté Client
// (lib/talent/admissibilite.ts) : sans cet écran, aucun profil ne pouvait
// être présenté à un Client depuis l'interface. Routes existantes :
// GET/POST /api/profils/[id]/competences, PATCH …/competences/[competenceId].

type Statut = "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU";
type Competence = { id: string; competence: string; statut: Statut };

const LIBELLE: Record<Statut, string> = {
  VERIFIE: "Vérifiée",
  DECLARE: "Déclarée par l'ingénieur",
  INFERE: "Extraite du CV",
  INCONNU: "Écartée",
};
const COULEUR: Record<Statut, string> = { VERIFIE: "#16a34a", DECLARE: "#d97706", INFERE: "#2563eb", INCONNU: "#9aa0ab" };

export function CompetencesProfil({ profilId }: { profilId: string }) {
  const [competences, setCompetences] = useState<Competence[]>([]);
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function charger() {
    setEtat("chargement");
    fetch(`/api/profils/${profilId}/competences`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setCompetences(d.competences ?? []);
        setEtat("pret");
      })
      .catch(() => setEtat("erreur"));
  }
  useEffect(charger, [profilId]);

  async function structurer() {
    setEnCours("structurer");
    setMessage("");
    const r = await fetch(`/api/profils/${profilId}/competences`, { method: "POST" });
    setEnCours(null);
    if (!r.ok) {
      setMessage("La structuration a échoué. Réessayez.");
      return;
    }
    const d = await r.json();
    setCompetences(d.competences ?? []);
  }

  async function changerStatut(c: Competence, statut: Statut) {
    setEnCours(c.id);
    setMessage("");
    const r = await fetch(`/api/profils/${profilId}/competences/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut, detail: statut === "VERIFIE" ? "Vérifiée par l'Admin" : "Écartée par l'Admin" }),
    });
    setEnCours(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMessage(d.error ?? "La modification a échoué. Réessayez.");
      return;
    }
    setCompetences((liste) => liste.map((x) => (x.id === c.id ? { ...x, statut } : x)));
  }

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
        Compétences ({competences.filter((c) => c.statut === "VERIFIE").length} vérifiée(s) sur {competences.length})
      </p>
      {etat === "chargement" && <p style={{ fontSize: 12, color: "#888" }}>Chargement…</p>}
      {etat === "erreur" && (
        <p role="alert" style={{ fontSize: 12, color: rouge }}>
          Impossible de charger les compétences.{" "}
          <button onClick={charger} style={{ fontSize: 12 }}>Réessayer</button>
        </p>
      )}
      {etat === "pret" && (
        <>
          <button
            onClick={structurer}
            disabled={enCours !== null}
            style={{ fontSize: 12, padding: "6px 10px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", marginBottom: 8 }}
          >
            {competences.length === 0 ? "Structurer les compétences" : "Mettre à jour depuis le CV et les déclarations"}
          </button>
          <p style={{ fontSize: 11, color: "#888", margin: "0 0 8px" }}>
            Seules les compétences vérifiées sont prises en compte pour proposer ce profil à un client.
          </p>
          {competences.length === 0 ? (
            <p style={{ fontSize: 12, color: "#aaa" }}>Aucune compétence structurée pour l&apos;instant.</p>
          ) : (
            <ul aria-label="Compétences du profil" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {competences.map((c) => (
                <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: bleuFonce, minWidth: 120 }}>{c.competence}</span>
                  <span style={{ color: COULEUR[c.statut], minWidth: 150 }}>{LIBELLE[c.statut]}</span>
                  {c.statut !== "VERIFIE" && (
                    <button onClick={() => changerStatut(c, "VERIFIE")} disabled={enCours !== null} aria-label={`Vérifier ${c.competence}`} style={{ fontSize: 11 }}>
                      Vérifier
                    </button>
                  )}
                  {c.statut !== "INCONNU" && (
                    <button onClick={() => changerStatut(c, "INCONNU")} disabled={enCours !== null} aria-label={`Écarter ${c.competence}`} style={{ fontSize: 11 }}>
                      Écarter
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {message && <p role="alert" style={{ fontSize: 12, color: rouge, marginTop: 6 }}>{message}</p>}
        </>
      )}
    </div>
  );
}
