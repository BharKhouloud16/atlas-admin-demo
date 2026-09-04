"use client";

import { useMemo, useState } from "react";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import { joursFeries, estWeekEnd } from "@/lib/jours-feries";
import { type JourCra } from "@/lib/feuilles-de-temps";

export type { JourCra };

const JOURS_SEMAINE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function joursDuMois(mois: string): string[] {
  const [annee, m] = mois.split("-").map(Number);
  const nbJours = new Date(annee, m, 0).getDate();
  return Array.from({ length: nbJours }, (_, i) => `${mois}-${String(i + 1).padStart(2, "0")}`);
}

// Index (0 = lundi ... 6 = dimanche) du premier jour du mois, pour aligner
// la grille (getDay() renvoie 0 = dimanche, on décale donc de 1).
function decalageDebutMois(mois: string): number {
  const [annee, m] = mois.split("-").map(Number);
  const jsDay = new Date(annee, m - 1, 1).getDay();
  return (jsDay + 6) % 7;
}

// Calendrier mensuel façon Boond/portage salarial : une case par jour, à
// cocher + un nombre d'heures en dessous. Les week-ends et jours fériés du
// PAYS DU CLIENT (pas celui de l'ingénieur, voir lib/jours-feries.ts) sont
// grisés par défaut ; l'ingénieur peut débloquer un jour grisé au cas par
// cas en saisissant un commentaire justificatif (ex. astreinte, jour férié
// travaillé). En lecture seule (editable=false), sert aussi à l'Admin/Client
// pour visualiser le détail d'une feuille déjà soumise.
export default function CalendrierCra({
  mois,
  paysClient,
  detail,
  editable,
  onChange,
}: {
  mois: string;
  paysClient: string | null;
  detail: JourCra[];
  editable: boolean;
  onChange?: (detail: JourCra[]) => void;
}) {
  const [joursDebloques, setJoursDebloques] = useState<Set<string>>(
    () => new Set(detail.filter((j) => j.commentaire).map((j) => j.date))
  );
  const [saisieCommentaire, setSaisieCommentaire] = useState<string | null>(null);

  const jours = useMemo(() => joursDuMois(mois), [mois]);
  const ferie = useMemo(() => new Set(joursFeries(paysClient, Number(mois.split("-")[0]))), [paysClient, mois]);
  const decalage = decalageDebutMois(mois);

  const parDate = useMemo(() => {
    const m = new Map<string, JourCra>();
    for (const j of detail) m.set(j.date, j);
    return m;
  }, [detail]);

  function majJour(date: string, patch: Partial<JourCra>) {
    if (!onChange) return;
    const existant = parDate.get(date) ?? { date, travaille: false, heures: 0 };
    const suivant = detail.filter((j) => j.date !== date);
    onChange([...suivant, { ...existant, ...patch }]);
  }

  function toggleJour(date: string, grise: boolean) {
    if (grise && !joursDebloques.has(date)) {
      // jour grisé, pas encore débloqué : ouvre la saisie du commentaire
      // plutôt que de cocher directement
      setSaisieCommentaire(date);
      return;
    }
    const existant = parDate.get(date);
    const nouveauTravaille = !existant?.travaille;
    majJour(date, { travaille: nouveauTravaille, heures: nouveauTravaille ? existant?.heures || 8 : 0 });
  }

  function confirmerDeblocage(date: string, commentaire: string) {
    if (!commentaire.trim()) return;
    setJoursDebloques((prev) => new Set(prev).add(date));
    majJour(date, { travaille: true, heures: 8, commentaire: commentaire.trim() });
    setSaisieCommentaire(null);
  }

  const totalHeures = detail.reduce((s, j) => s + (j.travaille ? j.heures || 0 : 0), 0);
  const totalJours = Math.round((totalHeures / 8) * 2) / 2;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {JOURS_SEMAINE.map((j) => (
          <div key={j} style={{ fontSize: 11, fontWeight: 600, color: grisTexte, textAlign: "center", padding: "2px 0" }}>
            {j}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {Array.from({ length: decalage }).map((_, i) => (
          <div key={"vide" + i} />
        ))}
        {jours.map((date) => {
          const j = parDate.get(date);
          const weekEnd = estWeekEnd(date);
          const jourFerie = ferie.has(date);
          const grise = (weekEnd || jourFerie) && !joursDebloques.has(date);
          const coche = !!j?.travaille;
          const numeroJour = Number(date.slice(-2));

          return (
            <div
              key={date}
              style={{
                border: `1px solid ${coche ? bleu : bordure}`,
                borderRadius: 6,
                padding: "6px 4px",
                minHeight: 64,
                background: grise ? "#f4f5f8" : coche ? "#eef3ff" : "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                opacity: grise && !editable ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 11, color: grise ? "#aab0ba" : grisTexte }}>{numeroJour}</span>
              {editable ? (
                <input
                  type="checkbox"
                  checked={coche}
                  onChange={() => toggleJour(date, weekEnd || jourFerie)}
                  title={grise ? "Jour grisé (week-end/férié) — cliquez pour débloquer" : undefined}
                  style={{ cursor: "pointer" }}
                />
              ) : (
                <span style={{ fontSize: 13 }}>{coche ? "✓" : grise ? "—" : ""}</span>
              )}
              {coche && editable && (
                <input
                  type="number"
                  min={0.5}
                  max={16}
                  step={0.5}
                  value={j?.heures ?? 8}
                  onChange={(e) => majJour(date, { heures: Number(e.target.value) })}
                  style={{ width: 38, fontSize: 11, padding: "1px 2px", textAlign: "center" }}
                />
              )}
              {coche && !editable && <span style={{ fontSize: 10, color: grisTexte }}>{j?.heures}h</span>}
              {(weekEnd || jourFerie) && (
                <span style={{ fontSize: 9, color: "#aab0ba", lineHeight: 1 }}>
                  {jourFerie ? "Férié" : "W-E"}
                </span>
              )}

              {saisieCommentaire === date && (
                <div
                  style={{
                    position: "relative",
                    zIndex: 5,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 4,
                      left: -40,
                      width: 180,
                      background: "#fff",
                      border: `1px solid ${bordure}`,
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(18,34,74,0.12)",
                      padding: 10,
                    }}
                  >
                    <p style={{ fontSize: 11, margin: "0 0 6px", color: bleuFonce, fontWeight: 600 }}>
                      Débloquer ce jour
                    </p>
                    <textarea
                      autoFocus
                      rows={2}
                      placeholder="Motif (ex. astreinte, jour férié travaillé)"
                      style={{ width: "100%", fontSize: 11, padding: 4, fontFamily: "inherit" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          confirmerDeblocage(date, (e.target as HTMLTextAreaElement).value);
                        }
                      }}
                      id={"commentaire-" + date}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => setSaisieCommentaire(null)}
                        style={{ fontSize: 11, padding: "3px 8px" }}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById("commentaire-" + date) as HTMLTextAreaElement | null;
                          confirmerDeblocage(date, el?.value ?? "");
                        }}
                        style={{ fontSize: 11, padding: "3px 8px", background: bleu, color: "#fff", border: "none", borderRadius: 4 }}
                      >
                        Débloquer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, color: grisTexte, flexWrap: "wrap" }}>
        <span>
          <strong style={{ color: bleuFonce }}>{totalJours}</strong> jour(s) équivalent
        </span>
        <span>
          <strong style={{ color: bleuFonce }}>{totalHeures}</strong> heure(s) déclarée(s)
        </span>
        {!paysClient && <span style={{ color: "#d97706" }}>Pays du client non renseigné — seul le socle Nouvel An/Noël est grisé.</span>}
      </div>
    </div>
  );
}
