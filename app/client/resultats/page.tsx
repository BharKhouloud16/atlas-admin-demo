"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, BientotDisponible } from "@/components/client/primitives";
import type { MissionEvaluable } from "@/components/client/EvaluationsAFaire";

// LOT 1 — Client Workspace Foundation (15/09/2026) : rubrique "Résultats" —
// même appel API que la page Missions (GET /api/evaluations, inchangé), qui
// renvoie déjà `evaluation: {note, commentaire} | null` pour chaque mission
// terminée. Jusqu'ici seules les missions SANS évaluation étaient affichées
// (formulaire à remplir) ; celles AVEC évaluation étaient silencieusement
// ignorées. Cette page affiche cette même donnée déjà renvoyée, jamais une
// donnée nouvelle ni calculée — c'est un historique réel, pas une mesure
// d'impact construite (pas de score agrégé, pas de moyenne mise en avant
// comme une métrique officielle : voir la mise en garde de l'audit contre
// la fausse précision mathématique).

export default function ResultatsClientPage() {
  const [missions, setMissions] = useState<MissionEvaluable[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    fetch("/api/evaluations")
      .then((r) => r.json())
      .then((d) => {
        setMissions(d.missions ?? []);
        setChargement(false);
      });
  }, []);

  const evaluees = missions.filter((m) => m.evaluation);

  return (
    <div>
      <Section title="Missions terminées évaluées">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && evaluees.length === 0 && (
          <EmptyState message="Aucune mission terminée évaluée pour l'instant." />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {evaluees.map((m) => (
            <Card key={m.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
                <span style={{ fontSize: 14, color: "#d97706", whiteSpace: "nowrap" }} aria-label={`${m.evaluation?.note} sur 5`}>
                  {"★".repeat(m.evaluation?.note ?? 0)}
                  {"☆".repeat(5 - (m.evaluation?.note ?? 0))}
                </span>
              </div>
              {m.evaluation?.commentaire && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: grisTexte }}>{m.evaluation.commentaire}</p>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Impact & mesure de la valeur">
        <BientotDisponible description="Des indicateurs de résultat plus larges (délai de staffing, taux de renouvellement, économies réalisées) seront ajoutés lorsque le moteur de mesure d'impact sera construit — aucune métrique n'est affichée avant d'être réellement calculée." />
      </Section>
    </div>
  );
}
