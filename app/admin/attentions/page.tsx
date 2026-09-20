"use client";

import { useEffect, useState } from "react";
import { bleu, bleuFonce, grisTexte, vert, orange, rouge } from "@/lib/theme";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// capacité Admin minimale (même discipline que app/admin/factures/page.tsx :
// style inline, jamais les primitives components/client/primitives.tsx,
// réservées à l'Espace Client). Filtres explicitement demandés par le mandat
// CEO section 13 : Client, Type, Priorité, Statut, Date, Source — jamais un
// filtre supplémentaire inventé. Filtrage appliqué CÔTÉ SERVEUR (GET
// /api/admin/attentions accepte déjà ces paramètres) — contrairement à
// /admin/factures (filtrage client-side sur une liste déjà chargée), la
// liste Attention grandit avec le temps (historique jamais purgé) : la
// pagination section 17 exige de ne jamais charger l'historique complet
// pour filtrer localement.

type Attention = {
  id: string;
  type: string;
  categorie: string;
  priorite: string;
  titre: string;
  resume: string;
  raison: string;
  statut: string;
  source: string;
  sourceId: string;
  clientId: string | null;
  clientNom: string | null;
  actionDisponible: { label: string; href: string } | null;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
};

type Client = { id: string; nom: string };

const LABEL_PRIORITE: Record<string, string> = {
  P0_CRITIQUE: "Critique",
  P1_HAUTE: "Haute",
  P2_NORMALE: "Normale",
  P3_BASSE: "Basse",
};
const LABEL_CATEGORIE: Record<string, string> = {
  ACTION_REQUISE: "Action requise",
  ALERTE: "Alerte",
  INFORMATION: "Information",
  RECOMMANDATION: "Recommandation",
};
const LABEL_STATUT: Record<string, string> = {
  OUVERTE: "Non lue",
  LUE: "Lue",
  RESOLUE: "Résolue",
  EXPIREE: "Expirée",
};
const COULEUR_PRIORITE: Record<string, string> = {
  P0_CRITIQUE: rouge,
  P1_HAUTE: orange,
  P2_NORMALE: bleu,
  P3_BASSE: grisTexte,
};

const TYPES = ["FACTURE_ENVOYEE", "FACTURE_ECHEANCE_PROCHE", "FACTURE_ECHUE", "PAIEMENT_RECU", "PAIEMENT_PARTIEL", "PAIEMENT_ANNULE", "ANOMALIE_FINANCIERE", "BESOIN_A_CLARIFIER"];

function badge(texte: string, couleur: string) {
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>
      {texte}
    </span>
  );
}

export default function AttentionsAdminPage() {
  const [attentions, setAttentions] = useState<Attention[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [nonLues, setNonLues] = useState(0);
  const [chargement, setChargement] = useState(true);

  const [historique, setHistorique] = useState(false);
  const [clientId, setClientId] = useState("");
  const [type, setType] = useState("");
  const [priorite, setPriorite] = useState("");
  const [statutFiltre, setStatutFiltre] = useState("");

  function recharger() {
    setChargement(true);
    const params = new URLSearchParams();
    if (historique) params.set("historique", "1");
    if (clientId) params.set("clientId", clientId);
    if (type) params.set("type", type);
    if (priorite) params.set("priorite", priorite);
    if (statutFiltre) params.set("statut", statutFiltre);
    params.set("limit", "100");

    fetch(`/api/admin/attentions?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setAttentions(d.attentions ?? []);
        setTotal(d.total ?? 0);
        setNonLues(d.nonLues ?? 0);
        setChargement(false);
      });
  }

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historique, clientId, type, priorite, statutFiltre]);

  async function marquerLu(id: string) {
    await fetch(`/api/admin/attentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lire" }),
    });
    recharger();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: bleuFonce, margin: 0 }}>Centre d&apos;attention</h1>
        <span style={{ fontSize: 13, color: grisTexte }}>
          {total} attention{total > 1 ? "s" : ""} · {nonLues} non lue{nonLues > 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #e4e7ee" }}>
          <option value="">Tous les clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #e4e7ee" }}>
          <option value="">Tous les types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={priorite} onChange={(e) => setPriorite(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #e4e7ee" }}>
          <option value="">Toutes les priorités</option>
          {Object.entries(LABEL_PRIORITE).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #e4e7ee" }}>
          <option value="">Statut (actif par défaut)</option>
          {Object.entries(LABEL_STATUT).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: grisTexte, cursor: "pointer" }}>
          <input type="checkbox" checked={historique} onChange={(e) => setHistorique(e.target.checked)} />
          Historique complet
        </label>
      </div>

      {chargement && <p style={{ fontSize: 13, color: grisTexte }}>Chargement…</p>}
      {!chargement && attentions.length === 0 && <p style={{ fontSize: 13, color: "#94a0b3" }}>Aucune attention pour ces filtres.</p>}
      {!chargement && attentions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {attentions.map((a) => (
            <div key={a.id} style={{ border: "1px solid #e4e7ee", borderRadius: 10, padding: 12, opacity: a.statut === "RESOLUE" || a.statut === "EXPIREE" ? 0.6 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {badge(LABEL_CATEGORIE[a.categorie] ?? a.categorie, COULEUR_PRIORITE[a.priorite] ?? grisTexte)}
                  {badge(LABEL_PRIORITE[a.priorite] ?? a.priorite, COULEUR_PRIORITE[a.priorite] ?? grisTexte)}
                  {badge(LABEL_STATUT[a.statut] ?? a.statut, a.statut === "OUVERTE" ? vert : grisTexte)}
                  {a.clientNom && badge(a.clientNom, bleu)}
                </div>
                <span style={{ fontSize: 11, color: grisTexte, whiteSpace: "nowrap" }}>{new Date(a.createdAt).toLocaleString("fr-FR")}</span>
              </div>
              <p style={{ margin: "8px 0 2px", fontWeight: 700, fontSize: 14 }}>{a.titre}</p>
              <p style={{ margin: "0 0 2px", fontSize: 13, color: grisTexte }}>{a.resume}</p>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#94a0b3" }}>
                {a.raison} — source : {a.source} ({a.sourceId})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {a.actionDisponible && (
                  <a href={a.actionDisponible.href} style={{ fontSize: 12, fontWeight: 600, color: bleu, textDecoration: "none" }}>
                    {a.actionDisponible.label}
                  </a>
                )}
                {a.statut === "OUVERTE" && (
                  <button
                    onClick={() => marquerLu(a.id)}
                    style={{ fontSize: 12, fontWeight: 600, color: grisTexte, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Marquer comme lu
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
