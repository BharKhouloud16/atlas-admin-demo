"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// "Mes WorkItems" — réservé Ingénieur, via la nouvelle route additive
// GET /api/ingenieur/work-items (DB-01). Aucune route WorkItem existante
// (A23) n'accepte l'Ingénieur (contrat verrouillé par tests dédiés) ; ce
// parcours est donc entièrement séparé, jamais une modification du
// périmètre Admin-only existant.
//
// Pagination : même idiome que GET /api/missions (page/pageSize) — seule
// liste de ce lot qui traverse plusieurs Missions dans le temps.

const TAILLE_PAGE = 20;

type WorkItem = {
  id: string;
  titre: string;
  statut: string;
  mission: { id: string; repere: string | null; client: { nom: string } };
};

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

export default function MesWorkItemsPage() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function recharger(pageDemandee: number = page) {
    setChargement(true);
    fetch(`/api/ingenieur/work-items?page=${pageDemandee}&pageSize=${TAILLE_PAGE}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setItems(d.items ?? []);
        setPage(d.page);
        setTotal(d.total);
        setTotalPages(d.totalPages);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: rouge }}>{erreur}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Mon travail</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20 }}>
        Les tâches (WorkItems) qui vous sont affectées, quelle que soit la Mission.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Tâche</th>
              <th style={{ padding: "6px 8px" }}>Mission</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{w.titre}</td>
                <td style={{ padding: "6px 8px" }}>{w.mission.repere ?? w.mission.client.nom}</td>
                <td style={{ padding: "6px 8px" }}><Badge statut={w.statut} /></td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/ingenieur/livraison/${w.id}`} style={{ color: bleu, fontSize: 12 }}>
                    Ouvrir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucune tâche affectée pour l&apos;instant.</p>}
      </div>

      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          <button
            onClick={() => recharger(page - 1)}
            disabled={page <= 1}
            style={{ padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}
          >
            Précédent
          </button>
          <span style={{ color: grisTexte }}>Page {page} / {totalPages} — {total} tâche{total > 1 ? "s" : ""} au total</span>
          <button
            onClick={() => recharger(page + 1)}
            disabled={page >= totalPages}
            style={{ padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.5 : 1 }}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
