"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, vert } from "@/lib/theme";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Consomme STRICTEMENT GET/POST /api/missions/[id]/capability-links et
// PATCH /api/missions/[id]/capability-links/[linkId] (A21, inchangées —
// aucune route backend ajoutée pour cette page). "Retirer" réutilise
// exactement la transition déjà autorisée par le contrat A21 §10 (ACTIVE
// -> SUPERSEDED), avec son audit déjà en place (journaliser(), voir la
// route). La création se limite ici au lien MANUEL (texte libre), seule
// forme explicitement autorisée par le contrat A21 §6/§11 sans
// information supplémentaire sur la version du Need pinnée — lier une
// CapabilityRequirement précise à une Mission reste possible via l'API
// existante mais n'a pas de formulaire dédié dans ce lot (aucune route
// n'expose aujourd'hui "les CapabilityRequirement éligibles pour CETTE
// Mission", ajouter une telle vue dépasserait "UI + API manquante
// strictement indispensable").

type MissionLien = {
  id: string;
  missionId: string;
  capabilityRequirementId: string | null;
  capability: string;
  rationale: string | null;
  statut: string;
  createdAt: string;
  createdByEmail: string;
};

const COULEUR_STATUT: Record<string, string> = { ACTIVE: vert, SUPERSEDED: grisTexte };

function Badge({ valeur }: { valeur: string }) {
  const couleur = COULEUR_STATUT[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

export default function MissionCapabilitesPage() {
  const params = useParams<{ id: string }>();
  const missionId = params.id;

  const [links, setLinks] = useState<MissionLien[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [capaciteTexte, setCapaciteTexte] = useState("");
  const [rationale, setRationale] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);

  const [retraitEnCours, setRetraitEnCours] = useState<string | null>(null);

  function charger() {
    setChargement(true);
    fetch(`/api/missions/${missionId}/capability-links`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setLinks(d.links ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function ajouterLienManuel(e: FormEvent) {
    e.preventDefault();
    if (!capaciteTexte.trim()) return;
    setEnvoi(true);
    setErreurEnvoi(null);
    const res = await fetch(`/api/missions/${missionId}/capability-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: capaciteTexte.trim(), rationale: rationale.trim() || undefined }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreurEnvoi(body?.error ?? "Erreur lors de la création du lien.");
      return;
    }
    setCapaciteTexte("");
    setRationale("");
    charger();
  }

  async function retirer(linkId: string) {
    if (!confirm("Confirmer le retrait de ce lien Capability ? Cette action est définitive (statut -> SUPERSEDED).")) return;
    setRetraitEnCours(linkId);
    const res = await fetch(`/api/missions/${missionId}/capability-links/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retirer" }),
    });
    setRetraitEnCours(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "Erreur lors du retrait du lien.");
      return;
    }
    charger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: "#b91c1c" }}>{erreur}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0, marginBottom: 4, color: bleuFonce }}>Capabilities de la Mission</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20, maxWidth: 700 }}>
        Liens MissionCapabilityLink réellement persistés (A21) — jamais un matching recalculé côté interface. Chaque
        lien référençant une CapabilityRequirement (A8) peut être ouvert pour en voir le détail et les autres Missions
        qui la mobilisent.
      </p>

      <div style={{ overflowX: "auto", marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Capacité</th>
              <th style={{ padding: "6px 8px" }}>Justification</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Lié le</th>
              <th style={{ padding: "6px 8px" }}>Par</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>
                  {l.capabilityRequirementId ? (
                    <Link href={`/admin/capabilities/${l.capabilityRequirementId}`} style={{ color: bleu }}>{l.capability}</Link>
                  ) : (
                    <>{l.capability} <span style={{ fontSize: 11, color: grisTexte }}>(lien manuel)</span></>
                  )}
                </td>
                <td style={{ padding: "6px 8px", color: grisTexte }}>{l.rationale ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={l.statut} /></td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{new Date(l.createdAt).toLocaleDateString("fr-FR")}</td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>{l.createdByEmail}</td>
                <td style={{ padding: "6px 8px" }}>
                  {l.statut === "ACTIVE" && (
                    <button
                      onClick={() => retirer(l.id)}
                      disabled={retraitEnCours === l.id}
                      style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                    >
                      {retraitEnCours === l.id ? "Retrait…" : "Retirer"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {links.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun lien Capability pour cette mission.</p>}
      </div>

      <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>+ Lien manuel</h2>
      <form onSubmit={ajouterLienManuel} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", maxWidth: 700 }}>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          Capacité
          <input value={capaciteTexte} onChange={(e) => setCapaciteTexte(e.target.value)} style={{ padding: 6 }} placeholder="ex. Kubernetes" />
        </label>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          Justification (optionnel)
          <input value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ padding: 6 }} />
        </label>
        <button type="submit" disabled={envoi || !capaciteTexte.trim()} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, border: `1px solid ${bleu}`, color: bleu, background: "#fff", cursor: "pointer" }}>
          {envoi ? "Envoi…" : "+ Ajouter"}
        </button>
      </form>
      {erreurEnvoi && <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 8 }}>{erreurEnvoi}</p>}
    </div>
  );
}
