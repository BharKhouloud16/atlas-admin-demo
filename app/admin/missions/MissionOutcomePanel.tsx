"use client";

import { useEffect, useState } from "react";
import { grisTexte, bordure, vert, orange, rouge } from "@/lib/theme";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Panneau MINIMAL, délibérément séparé de MissionClosureReview.tsx (A6
// §A6.3 : Evidence/Quality des compétences Ingénieur ≠ Outcome du Need —
// ne jamais fusionner ces deux préoccupations dans un même composant).
// N'affiche/ne crée jamais rien sur SkillEvidence/MissionSkillProposal.
//
// RÈGLE ABSOLUE visible ici : si la Mission n'a aucun critère disponible
// (aucun CRITERE_REUSSITE actif sur la version du Need pinnée), le
// panneau l'affiche explicitement et ne permet qu'un INDETERMINABLE
// global — jamais un bouton "Marquer comme réussi" sans aucun critère.

type Statut = "OBTENU" | "PARTIELLEMENT_OBTENU" | "NON_OBTENU" | "INDETERMINABLE";
type Methode = "VERIFIE_HUMAIN" | "DECLARE_CLIENT" | "MESURE_SYSTEME" | "INFERE_IA";

const LABEL_STATUT: Record<Statut, string> = {
  OBTENU: "Obtenu",
  PARTIELLEMENT_OBTENU: "Partiellement obtenu",
  NON_OBTENU: "Non obtenu",
  INDETERMINABLE: "Indéterminable (preuve insuffisante)",
};
const COULEUR_STATUT: Record<Statut, string> = {
  OBTENU: vert,
  PARTIELLEMENT_OBTENU: orange,
  NON_OBTENU: rouge,
  INDETERMINABLE: grisTexte,
};
const LABEL_METHODE: Record<Methode, string> = {
  VERIFIE_HUMAIN: "Vérifié par un humain (ATLAS)",
  DECLARE_CLIENT: "Déclaré par le client",
  MESURE_SYSTEME: "Mesuré par le système",
  INFERE_IA: "Proposé par une IA (jamais suffisant seul)",
};

type CritereResultat = {
  id: string;
  sourceFaitId: string | null;
  criterionText: string;
  status: Statut;
  confidence: string;
  verificationMethod: Methode | null;
  evidences: { id: string; source: string; detail: string | null }[];
};

type Outcome = {
  id: string;
  overallStatus: Statut;
  expectedOutcome: string | null;
  assessedAt: string;
  assessedByEmail: string;
  criteria: CritereResultat[];
};

type Contexte = {
  needVersionId: string | null;
  expectedOutcome: string | null;
  criteresDisponibles: { id: string; valeur: string }[];
};

type Saisie = { statutPropose: Statut; methode: Methode | ""; source: string; detail: string };

export default function MissionOutcomePanel({ missionId, onFermer }: { missionId: string; onFermer: () => void }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [contexte, setContexte] = useState<Contexte | null>(null);
  const [erreurChargement, setErreurChargement] = useState("");
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState("");

  useEffect(() => {
    let annule = false;
    (async () => {
      const res = await fetch(`/api/missions/${missionId}/outcome`);
      if (annule) return;
      if (!res.ok) {
        setErreurChargement("Impossible de charger l'Outcome de cette mission.");
        return;
      }
      const data = await res.json();
      setOutcome(data.outcome);
      setContexte({ needVersionId: data.needVersionId, expectedOutcome: data.expectedOutcome, criteresDisponibles: data.criteresDisponibles });
      setSaisies(
        Object.fromEntries(
          (data.criteresDisponibles as { id: string }[]).map((c) => [c.id, { statutPropose: "INDETERMINABLE" as Statut, methode: "" as const, source: "", detail: "" }])
        )
      );
    })();
    return () => {
      annule = true;
    };
  }, [missionId]);

  async function soumettre() {
    setEnvoi(true);
    setErreurEnvoi("");
    const verdicts = Object.entries(saisies).map(([sourceFaitId, s]) => ({
      sourceFaitId,
      statutPropose: s.statutPropose,
      methodes: s.methode ? [s.methode] : [],
      evidences: s.source.trim() ? [{ source: s.source.trim(), detail: s.detail.trim() || undefined }] : [],
    }));
    const res = await fetch(`/api/missions/${missionId}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdicts }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreurEnvoi(body?.error ?? "Erreur lors de l'enregistrement de l'Outcome.");
      return;
    }
    const data = await res.json();
    setOutcome(data.outcome);
  }

  if (erreurChargement) return <div style={{ padding: 16, fontSize: 13, color: rouge }}>{erreurChargement}</div>;
  if (!contexte) return <div style={{ padding: 16, fontSize: 13, color: grisTexte }}>Chargement…</div>;

  return (
    <div style={{ padding: 16, borderTop: `1px solid ${bordure}`, background: "#fafafa" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Résultat attendu (Outcome)</p>
        <button onClick={onFermer} style={{ fontSize: 11, border: "none", background: "none", cursor: "pointer", color: grisTexte }}>
          Fermer
        </button>
      </div>

      <p style={{ fontSize: 12, color: grisTexte, margin: "6px 0 12px" }}>
        {contexte.expectedOutcome ? <>Résultat attendu déclaré : « {contexte.expectedOutcome} »</> : "Aucun résultat attendu (RESULTAT_ATTENDU) n'a été renseigné sur ce besoin."}
      </p>

      {outcome && (
        <div style={{ marginBottom: 12, padding: 8, border: `1px solid ${bordure}`, background: "#fff" }}>
          <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>
            Dernière évaluation — {new Date(outcome.assessedAt).toLocaleDateString("fr-FR")} par {outcome.assessedByEmail}
          </p>
          <p style={{ margin: "4px 0 0", fontWeight: 600, color: COULEUR_STATUT[outcome.overallStatus] }}>
            {LABEL_STATUT[outcome.overallStatus]}
          </p>
        </div>
      )}

      {contexte.criteresDisponibles.length === 0 ? (
        <p style={{ fontSize: 13, color: grisTexte }}>
          Aucun critère de réussite (CRITERE_REUSSITE) n'est disponible sur la version du besoin à l'origine de cette mission —
          l'Outcome de cette mission ne peut être qu'<strong>indéterminable</strong>, jamais inventé.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {contexte.criteresDisponibles.map((c) => {
            const s = saisies[c.id] ?? { statutPropose: "INDETERMINABLE" as Statut, methode: "" as const, source: "", detail: "" };
            return (
              <div key={c.id} style={{ padding: 8, border: `1px solid ${bordure}`, background: "#fff" }}>
                <p style={{ margin: "0 0 6px", fontSize: 13 }}>{c.valeur}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={s.statutPropose}
                    onChange={(e) => setSaisies((prev) => ({ ...prev, [c.id]: { ...s, statutPropose: e.target.value as Statut } }))}
                    style={{ fontSize: 12 }}
                  >
                    {(Object.keys(LABEL_STATUT) as Statut[]).map((st) => (
                      <option key={st} value={st}>{LABEL_STATUT[st]}</option>
                    ))}
                  </select>
                  <select
                    value={s.methode}
                    onChange={(e) => setSaisies((prev) => ({ ...prev, [c.id]: { ...s, methode: e.target.value as Methode | "" } }))}
                    style={{ fontSize: 12 }}
                  >
                    <option value="">Méthode de vérification…</option>
                    {(Object.keys(LABEL_METHODE) as Methode[]).map((m) => (
                      <option key={m} value={m}>{LABEL_METHODE[m]}</option>
                    ))}
                  </select>
                </div>
                <input
                  placeholder="Source de la preuve (ex. rapport de tests, email client, constat ATLAS)"
                  value={s.source}
                  onChange={(e) => setSaisies((prev) => ({ ...prev, [c.id]: { ...s, source: e.target.value } }))}
                  style={{ marginTop: 6, width: "100%", fontSize: 12, padding: 4 }}
                />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: grisTexte }}>
                  Sans preuve ni méthode renseignées, ce critère reste automatiquement « Indéterminable ».
                </p>
              </div>
            );
          })}
        </div>
      )}

      {erreurEnvoi && <p style={{ fontSize: 12, color: rouge, marginTop: 8 }}>{erreurEnvoi}</p>}

      {contexte.criteresDisponibles.length > 0 && (
        <button
          onClick={soumettre}
          disabled={envoi}
          style={{ marginTop: 10, fontSize: 12, padding: "6px 12px", border: `1px solid ${bordure}`, background: "#fff", cursor: envoi ? "default" : "pointer" }}
        >
          {envoi ? "Enregistrement…" : outcome ? "Réévaluer (nouvelle évaluation)" : "Enregistrer l'Outcome"}
        </button>
      )}
    </div>
  );
}
