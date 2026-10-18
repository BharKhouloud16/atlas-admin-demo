"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Liste des WorkItem d'une Mission — réservé ADMIN (contrat A23 : aucune
// route WorkItem n'accepte INGENIEUR, confirmé par tests dédiés a23 #52/
// a24 #45). Réutilise EXACTEMENT GET/POST /api/missions/[id]/work-items
// (A23, inchangées) — aucune nouvelle logique métier, aucune nouvelle
// validation : le serveur reste seul juge (TitreInvalideError/
// MissionFermeeError déjà gérés par la route existante).
//
// Pas de pagination ici : listerWorkItemsMission (A23) n'en expose aucune
// (contrat DB-01 §10 — "utilise la pagination existante si l'API la
// supporte" ; elle ne la supporte pas, donc aucune n'est ajoutée).

type WorkItem = { id: string; titre: string; description: string | null; statut: string };

const COULEUR_STATUT: Record<string, string> = {
  A_FAIRE: grisTexte,
  EN_COURS: bleu,
  BLOQUE: rouge,
  TERMINE: "#1a7f4b",
  ANNULE: "#888",
};

function Badge({ statut }: { statut: string }) {
  const couleur = COULEUR_STATUT[statut] ?? grisTexte;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>
      {statut}
    </span>
  );
}

export default function WorkItemsMissionPage() {
  const params = useParams<{ id: string }>();
  const missionId = params.id;

  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [afficherFormulaire, setAfficherFormulaire] = useState(false);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    fetch(`/api/missions/${missionId}/work-items`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setWorkItems(d.workItems ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function creerWorkItem(e: FormEvent) {
    e.preventDefault();
    setErreurCreation(null);
    if (!titre.trim()) {
      setErreurCreation("Le titre est requis.");
      return;
    }
    setCreation(true);
    const res = await fetch(`/api/missions/${missionId}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre, description: description || undefined }),
    });
    setCreation(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurCreation(err.error ?? "Erreur lors de la création du WorkItem.");
      return;
    }
    setTitre("");
    setDescription("");
    setAfficherFormulaire(false);
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: rouge }}>{erreur}</p>;

  return (
    <div>
      <Link href="/admin/missions" style={{ color: bleu, fontSize: 13 }}>← Toutes les missions</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>WorkItems de la mission</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20 }}>
        Le travail opérationnel décomposé pour cette mission : chaque WorkItem suit son propre statut, indépendant du
        lifecycle de la Mission.
      </p>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setAfficherFormulaire((v) => !v)}
          style={{ padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer" }}
        >
          {afficherFormulaire ? "Annuler" : "+ Nouveau WorkItem"}
        </button>

        {afficherFormulaire && (
          <form
            onSubmit={creerWorkItem}
            style={{ marginTop: 12, padding: 16, border: `1px solid ${bordure}`, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", maxWidth: 700 }}
          >
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
              Titre
              <input value={titre} onChange={(e) => setTitre(e.target.value)} style={{ padding: 6 }} />
            </label>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
              Description (optionnel)
              <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ padding: 6 }} />
            </label>
            <button type="submit" disabled={creation} style={{ padding: "8px 16px", fontWeight: 600 }}>
              {creation ? "Création…" : "Créer"}
            </button>
            {erreurCreation && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurCreation}</p>}
          </form>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Titre</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {workItems.map((w) => (
              <tr key={w.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{w.titre}</td>
                <td style={{ padding: "6px 8px" }}><Badge statut={w.statut} /></td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/missions/${missionId}/work-items/${w.id}`} style={{ color: bleu, fontSize: 12 }}>
                    Ouvrir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {workItems.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun WorkItem pour l&apos;instant.</p>}
      </div>
    </div>
  );
}
