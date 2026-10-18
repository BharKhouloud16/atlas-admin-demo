"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Card, Badge, EmptyState, type BadgeVariant } from "@/components/client/primitives";

// COMPANY ATLAS — DB-08 : Outcome UI — Intégration V1 (08/10/2026).
//
// Lecture STRICTEMENT seule : le backend (app/api/missions/[id]/outcome/
// route.ts, A6.1, inchangé par ce lot) autorise explicitement CLIENT en
// GET — jamais en POST (403, voir le commentaire d'en-tête de cette
// route) — sur ses propres missions uniquement (tenant vérifié côté
// serveur, 404 sinon pour une mission d'un autre client). Ce composant
// n'appelle donc jamais rien d'autre qu'un GET sur la route existante, et
// ne rend aucune action de mutation (aucun bouton "créer"/"réévaluer").
//
// assessedByEmail (identité interne Admin, renvoyée telle quelle par la
// route pour tout rôle autorisé) est délibérément omis ici — jamais
// affiché au Client, à la différence du panneau Admin
// (app/admin/missions/MissionOutcomePanel.tsx) qui le montre. C'est la
// seule donnée du contrat filtrée côté UI (jamais côté API, qui reste
// inchangée) : un choix éditorial pour ne jamais exposer une identité
// d'administration au Client (mandat DB-08 §8), pas une restriction
// imposée par le backend.

type Statut = "OBTENU" | "PARTIELLEMENT_OBTENU" | "NON_OBTENU" | "INDETERMINABLE";
type Methode = "VERIFIE_HUMAIN" | "DECLARE_CLIENT" | "MESURE_SYSTEME" | "INFERE_IA";

const VARIANT_STATUT: Record<Statut, BadgeVariant> = {
  OBTENU: "success",
  PARTIELLEMENT_OBTENU: "warning",
  NON_OBTENU: "error",
  INDETERMINABLE: "neutral",
};
const LABEL_STATUT: Record<Statut, string> = {
  OBTENU: "Obtenu",
  PARTIELLEMENT_OBTENU: "Partiellement obtenu",
  NON_OBTENU: "Non obtenu",
  INDETERMINABLE: "Indéterminable (preuve insuffisante)",
};
const LABEL_METHODE: Record<Methode, string> = {
  VERIFIE_HUMAIN: "Vérifié par ATLAS",
  DECLARE_CLIENT: "Déclaré par vous",
  MESURE_SYSTEME: "Mesuré par le système",
  INFERE_IA: "Proposé par une IA",
};

type CritereResultat = {
  id: string;
  criterionText: string;
  status: Statut;
  verificationMethod: Methode | null;
  evidences: { id: string; source: string; detail: string | null }[];
};

type Outcome = {
  overallStatus: Statut;
  assessedAt: string;
  criteria: CritereResultat[];
};

export default function MissionOutcomeSection({ missionId }: { missionId: string }) {
  const [etat, setEtat] = useState<"chargement" | "pret" | "erreur">("chargement");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [expectedOutcome, setExpectedOutcome] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setEtat("chargement");
    fetch(`/api/missions/${missionId}/outcome`)
      .then((r) => {
        if (!r.ok) throw new Error("echec");
        return r.json();
      })
      .then((data) => {
        if (annule) return;
        setOutcome(data.outcome);
        setExpectedOutcome(data.expectedOutcome);
        setEtat("pret");
      })
      .catch(() => {
        if (!annule) setEtat("erreur");
      });
    return () => {
      annule = true;
    };
  }, [missionId]);

  if (etat === "chargement") return <EmptyState message="Chargement du résultat…" />;
  if (etat === "erreur") return <EmptyState message="Impossible de charger le résultat de cette mission." />;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>
        {expectedOutcome ? <>Résultat attendu : « {expectedOutcome} »</> : "Aucun résultat attendu n'a été renseigné pour ce besoin."}
      </p>

      {!outcome ? (
        <EmptyState message="Aucune évaluation de résultat n'a encore été enregistrée pour cette mission." />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge variant={VARIANT_STATUT[outcome.overallStatus]}>{LABEL_STATUT[outcome.overallStatus]}</Badge>
            <span style={{ fontSize: 11, color: "#94a0b3" }}>évalué le {new Date(outcome.assessedAt).toLocaleDateString("fr-FR")}</span>
          </div>
          {outcome.criteria.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {outcome.criteria.map((c) => (
                <Card key={c.id} style={{ padding: 10 }}>
                  <p style={{ margin: "0 0 4px", fontSize: 13 }}>{c.criterionText}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge variant={VARIANT_STATUT[c.status]}>{LABEL_STATUT[c.status]}</Badge>
                    {c.verificationMethod && <span style={{ fontSize: 11, color: "#94a0b3" }}>{LABEL_METHODE[c.verificationMethod]}</span>}
                  </div>
                  {c.evidences.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: grisTexte }}>
                      {c.evidences.map((e) => (
                        <li key={e.id}>
                          {e.source}
                          {e.detail ? ` — ${e.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
