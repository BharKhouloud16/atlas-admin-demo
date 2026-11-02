"use client";

import { useEffect, useState } from "react";
import { bleu, bordure, grisTexte, rouge, vert, orange } from "@/lib/theme";

// LOT 5 (28/10/2026) — demandes d'activation ATLAS OS : l'Admin active,
// refuse (motif communiqué au Client) ou désactive. Chaque décision est
// journalisée (Journal d'activité).

type Activation = {
  clientId: string;
  statut: "DEMANDEE" | "ACTIVEE" | "REFUSEE" | "DESACTIVEE";
  demandeLe: string;
  demandeParEmail: string;
  motifDemande: string | null;
  decideLe: string | null;
  decideParEmail: string | null;
  motifDecision: string | null;
  client: { nom: string; pays: string | null };
};

const LIBELLE: Record<Activation["statut"], string> = { DEMANDEE: "À traiter", ACTIVEE: "Activé", REFUSEE: "Refusé", DESACTIVEE: "Désactivé" };
const COULEUR: Record<Activation["statut"], string> = { DEMANDEE: orange, ACTIVEE: vert, REFUSEE: rouge, DESACTIVEE: grisTexte };

export default function ActivationsAtlasOsPage() {
  const [lignes, setLignes] = useState<Activation[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function charger() {
    fetch("/api/atlas-os/activations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setLignes(d.activations ?? []))
      .catch(() => setErreur("Impossible de charger les demandes d'activation."));
  }
  useEffect(charger, []);

  async function decider(clientId: string, statut: "ACTIVEE" | "REFUSEE" | "DESACTIVEE") {
    let motif: string | null = null;
    if (statut !== "ACTIVEE") {
      motif = window.prompt(statut === "REFUSEE" ? "Motif du refus (communiqué au client) :" : "Motif de la désactivation :") ?? null;
      if (motif === null) return;
    }
    setErreur(null);
    const reponse = await fetch(`/api/atlas-os/activations/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut, motif }),
    });
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Une erreur est survenue.");
    }
    charger();
  }

  const bouton = (couleur: string, plein: boolean) => ({
    background: plein ? couleur : "#fff",
    color: plein ? "#fff" : couleur,
    border: `1px solid ${couleur}`,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>Activations ATLAS OS</h1>
      <p style={{ fontSize: 13, color: grisTexte }}>
        ATLAS OS est un module optionnel, jamais activé automatiquement. Activez-le pour un client qui en fait la demande ; aucun
        paiement ni abonnement n&apos;est associé.
      </p>
      {erreur && <p role="alert" style={{ color: rouge, fontSize: 13 }}>{erreur}</p>}
      {lignes && lignes.length === 0 && <p style={{ fontSize: 13, color: grisTexte }}>Aucune demande pour l&apos;instant.</p>}
      {lignes && lignes.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff" }}>
          <thead>
            <tr style={{ textAlign: "left", color: grisTexte }}>
              <th style={{ padding: 8 }}>Client</th>
              <th style={{ padding: 8 }}>Demande</th>
              <th style={{ padding: 8 }}>Statut</th>
              <th style={{ padding: 8 }}>Décision</th>
              <th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.clientId} style={{ borderTop: `1px solid ${bordure}`, verticalAlign: "top" }}>
                <td style={{ padding: 8 }}>
                  {l.client.nom}
                  {l.client.pays && <span style={{ color: grisTexte }}> · {l.client.pays}</span>}
                </td>
                <td style={{ padding: 8 }}>
                  {new Date(l.demandeLe).toLocaleDateString("fr-FR")} — {l.demandeParEmail}
                  {l.motifDemande && <div style={{ color: grisTexte }}>« {l.motifDemande} »</div>}
                </td>
                <td style={{ padding: 8, color: COULEUR[l.statut], fontWeight: 600 }}>{LIBELLE[l.statut]}</td>
                <td style={{ padding: 8, color: grisTexte }}>
                  {l.decideLe ? `${new Date(l.decideLe).toLocaleDateString("fr-FR")} — ${l.decideParEmail}` : "—"}
                  {l.motifDecision && <div>« {l.motifDecision} »</div>}
                </td>
                <td style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(l.statut === "DEMANDEE" || l.statut === "REFUSEE" || l.statut === "DESACTIVEE") && (
                    <button onClick={() => decider(l.clientId, "ACTIVEE")} style={bouton(bleu, true)}>Activer</button>
                  )}
                  {l.statut === "DEMANDEE" && <button onClick={() => decider(l.clientId, "REFUSEE")} style={bouton(rouge, false)}>Refuser</button>}
                  {l.statut === "ACTIVEE" && <button onClick={() => decider(l.clientId, "DESACTIVEE")} style={bouton(grisTexte, false)}>Désactiver</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
