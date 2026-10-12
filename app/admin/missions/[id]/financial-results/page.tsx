"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-02 : Financial Result UI (08/10/2026).
//
// Consomme STRICTEMENT le Financial Engine existant (A29,
// lib/financial-result/financial-result.ts + app/api/missions/[id]/
// financial-results/**, inchangés) — ADMIN-only de bout en bout (contrat
// A29 §28/§29, déjà vérifié par la route elle-même ; cette page n'ajoute
// aucune seconde vérification RBAC, elle se contente de refléter les
// refus serveur). Aucun calcul financier ici : profitAmount/marginPct/
// resultatGlobal sont toujours affichés tels que renvoyés par le serveur,
// jamais recalculés côté client (contrat DB-02 §11).
//
// Plusieurs FinancialResult INDÉPENDANTS peuvent coexister pour une même
// Mission (contrat A29 §35, confirmé par test a29 #44 : "double création
// simultanée -> toutes deux autorisées, aucun invariant croisé") — cette
// page affiche donc TOUT l'historique renvoyé par
// GET /api/missions/[id]/financial-results, jamais un seul "résultat
// courant" supposé unique. Au sein d'une même chaîne de correction
// (supersedesId), la ligne sans successeur (aucune autre ligne ne pointe
// vers elle) est marquée "courante" ; une ligne FINALIZED reste
// strictement immuable (contenu), toute correction se fait par une
// NOUVELLE ligne (jamais un écrasement).

type FinancialResult = {
  id: string;
  currency: string;
  revenueAmount: string | null;
  revenueProvenance: string | null;
  revenueJustification: string | null;
  costAmount: string | null;
  costProvenance: string | null;
  costJustification: string | null;
  profitAmount: string | null;
  marginPct: string | null;
  resultatGlobal: string;
  statut: string;
  supersedesId: string | null;
  calculatedAt: string;
  calculatedByEmail: string;
  createdAt: string;
};

const COULEUR_RESULTAT: Record<string, string> = {
  PROFIT: "#1a7f4b",
  BREAK_EVEN: grisTexte,
  LOSS: rouge,
  NOT_DETERMINABLE: "#888",
};
const COULEUR_STATUT: Record<string, string> = { DRAFT: grisTexte, FINALIZED: "#1a7f4b" };

function Badge({ valeur, couleurs }: { valeur: string; couleurs: Record<string, string> }) {
  const couleur = couleurs[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

function formaterMontant(montant: string | null, devise: string): string {
  if (montant === null) return "Inconnu";
  return `${Number(montant).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

function formaterPourcentage(valeur: string | null): string {
  if (valeur === null) return "Non déterminable";
  return `${(Number(valeur) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

type FormulaireMontant = { amount: string; provenance: string; justification: string };
const PROVENANCES = ["DECLARE", "VERIFIE"] as const;

function videFormulaire(): { revenue: FormulaireMontant; cost: FormulaireMontant; currency: string } {
  return { revenue: { amount: "", provenance: "DECLARE", justification: "" }, cost: { amount: "", provenance: "DECLARE", justification: "" }, currency: "" };
}

export default function FinancialResultsPage() {
  const params = useParams<{ id: string }>();
  const missionId = params.id;

  const [resultats, setResultats] = useState<FinancialResult[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    fetch(`/api/missions/${missionId}/financial-results`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setResultats(d.financialResults ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  // --- Création (nouveau résultat indépendant, ou correction d'un résultat FINALIZED) ---
  const [creationPourSupersede, setCreationPourSupersede] = useState<string | null>(null);
  const [afficherCreationLibre, setAfficherCreationLibre] = useState(false);
  const [formulaire, setFormulaire] = useState(videFormulaire());
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  async function creerResultat(e: FormEvent, supersedesId?: string) {
    e.preventDefault();
    setErreurCreation(null);
    setCreation(true);
    const corps: Record<string, unknown> = { supersedesId: supersedesId ?? undefined };
    if (formulaire.currency.trim()) corps.currency = formulaire.currency.trim();
    if (formulaire.revenue.amount.trim()) {
      corps.revenueAmount = Number(formulaire.revenue.amount);
      corps.revenueProvenance = formulaire.revenue.provenance;
      corps.revenueJustification = formulaire.revenue.justification;
    }
    if (formulaire.cost.amount.trim()) {
      corps.costAmount = Number(formulaire.cost.amount);
      corps.costProvenance = formulaire.cost.provenance;
      corps.costJustification = formulaire.cost.justification;
    }
    const res = await fetch(`/api/missions/${missionId}/financial-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    setCreation(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurCreation(err.error ?? "Erreur lors de la création.");
      return;
    }
    setFormulaire(videFormulaire());
    setCreationPourSupersede(null);
    setAfficherCreationLibre(false);
    recharger();
  }

  // --- Édition de contenu (DRAFT uniquement) ---
  const [editionId, setEditionId] = useState<string | null>(null);
  const [erreurEdition, setErreurEdition] = useState<string | null>(null);

  function ouvrirEdition(r: FinancialResult) {
    setEditionId(r.id);
    setFormulaire({
      currency: r.currency,
      revenue: { amount: r.revenueAmount ?? "", provenance: r.revenueProvenance ?? "DECLARE", justification: r.revenueJustification ?? "" },
      cost: { amount: r.costAmount ?? "", provenance: r.costProvenance ?? "DECLARE", justification: r.costJustification ?? "" },
    });
  }

  async function sauvegarderEdition(e: FormEvent, resultId: string) {
    e.preventDefault();
    setErreurEdition(null);
    const corps: Record<string, unknown> = { currency: formulaire.currency.trim() || undefined };
    corps.revenueAmount = formulaire.revenue.amount.trim() ? Number(formulaire.revenue.amount) : null;
    if (formulaire.revenue.amount.trim()) {
      corps.revenueProvenance = formulaire.revenue.provenance;
      corps.revenueJustification = formulaire.revenue.justification;
    }
    corps.costAmount = formulaire.cost.amount.trim() ? Number(formulaire.cost.amount) : null;
    if (formulaire.cost.amount.trim()) {
      corps.costProvenance = formulaire.cost.provenance;
      corps.costJustification = formulaire.cost.justification;
    }
    const res = await fetch(`/api/missions/${missionId}/financial-results/${resultId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurEdition(err.error ?? "Erreur lors de la mise à jour.");
      return;
    }
    setEditionId(null);
    recharger();
  }

  async function finaliser(resultId: string) {
    if (!confirm("Finaliser ce résultat financier ? Son contenu deviendra définitivement immuable.")) return;
    const res = await fetch(`/api/missions/${missionId}/financial-results/${resultId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finaliser" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la finalisation.");
      return;
    }
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: rouge }}>{erreur}</p>;

  const idsSuperseded = new Set(resultats.filter((r) => r.supersedesId).map((r) => r.supersedesId as string));
  const tri = [...resultats].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  function FormulaireMontants({ cible }: { cible: "revenue" | "cost" }) {
    const valeurs = formulaire[cible];
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
          {cible === "revenue" ? "Revenu" : "Coût"}
          <input
            type="number"
            step="0.01"
            value={valeurs.amount}
            onChange={(e) => setFormulaire((f) => ({ ...f, [cible]: { ...f[cible], amount: e.target.value } }))}
            style={{ padding: 4, width: 110 }}
          />
        </label>
        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
          Provenance
          <select
            value={valeurs.provenance}
            onChange={(e) => setFormulaire((f) => ({ ...f, [cible]: { ...f[cible], provenance: e.target.value } }))}
            style={{ padding: 4 }}
          >
            {PROVENANCES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 160 }}>
          Justification
          <input
            value={valeurs.justification}
            onChange={(e) => setFormulaire((f) => ({ ...f, [cible]: { ...f[cible], justification: e.target.value } }))}
            style={{ padding: 4 }}
          />
        </label>
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/missions" style={{ color: bleu, fontSize: 13 }}>← Toutes les missions</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>Résultat financier</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20 }}>
        Résultat financier réel de la mission, déclaré par un Admin — jamais calculé automatiquement depuis le TJM ou la marge cible.
      </p>

      {resultats.length === 0 && <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>Aucun résultat financier enregistré pour cette mission.</p>}

      {tri.map((r) => {
        const estCourant = !idsSuperseded.has(r.id);
        return (
          <div key={r.id} style={{ padding: 12, border: `1px solid ${bordure}`, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <Badge valeur={r.statut} couleurs={COULEUR_STATUT} />
              <Badge valeur={r.resultatGlobal} couleurs={COULEUR_RESULTAT} />
              {estCourant ? <span style={{ fontSize: 11, color: grisTexte }}>(courant)</span> : <span style={{ fontSize: 11, color: "#888" }}>(historique)</span>}
              {r.supersedesId && <span style={{ fontSize: 11, color: "#888" }}>— remplace {r.supersedesId}</span>}
              <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>{new Date(r.createdAt).toLocaleString("fr-FR")}</span>
            </div>

            {editionId === r.id ? (
              <form onSubmit={(e) => sauvegarderEdition(e, r.id)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2, width: 100 }}>
                  Devise
                  <input value={formulaire.currency} onChange={(e) => setFormulaire((f) => ({ ...f, currency: e.target.value }))} style={{ padding: 4 }} />
                </label>
                <FormulaireMontants cible="revenue" />
                <FormulaireMontants cible="cost" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" style={{ fontSize: 12, padding: "4px 10px", fontWeight: 600 }}>Enregistrer</button>
                  <button type="button" onClick={() => setEditionId(null)} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Annuler</button>
                </div>
                {erreurEdition && <p style={{ fontSize: 12, color: rouge, margin: 0 }}>{erreurEdition}</p>}
              </form>
            ) : (
              <>
                <table style={{ fontSize: 13, marginBottom: 8 }}>
                  <tbody>
                    <tr><td style={{ color: grisTexte, paddingRight: 12 }}>Revenu</td><td>{formaterMontant(r.revenueAmount, r.currency)}{r.revenueProvenance ? ` (${r.revenueProvenance})` : ""}</td></tr>
                    {r.revenueJustification && <tr><td style={{ color: grisTexte, paddingRight: 12 }}></td><td style={{ fontSize: 12, color: grisTexte }}>{r.revenueJustification}</td></tr>}
                    <tr><td style={{ color: grisTexte, paddingRight: 12 }}>Coût</td><td>{formaterMontant(r.costAmount, r.currency)}{r.costProvenance ? ` (${r.costProvenance})` : ""}</td></tr>
                    {r.costJustification && <tr><td style={{ color: grisTexte, paddingRight: 12 }}></td><td style={{ fontSize: 12, color: grisTexte }}>{r.costJustification}</td></tr>}
                    <tr><td style={{ color: grisTexte, paddingRight: 12 }}>Résultat (profit)</td><td><strong>{formaterMontant(r.profitAmount, r.currency)}</strong></td></tr>
                    <tr><td style={{ color: grisTexte, paddingRight: 12 }}>Marge</td><td>{formaterPourcentage(r.marginPct)}</td></tr>
                    <tr><td style={{ color: grisTexte, paddingRight: 12 }}>Calculé par</td><td style={{ fontSize: 12 }}>{r.calculatedByEmail} · {new Date(r.calculatedAt).toLocaleDateString("fr-FR")}</td></tr>
                  </tbody>
                </table>

                {r.statut === "DRAFT" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => ouvrirEdition(r)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Modifier</button>
                    <button onClick={() => finaliser(r.id)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Finaliser</button>
                  </div>
                )}
                {r.statut === "FINALIZED" && estCourant && (
                  <button
                    onClick={() => { setCreationPourSupersede(r.id); setFormulaire(videFormulaire()); }}
                    style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                  >
                    + Correction (nouvelle ligne)
                  </button>
                )}

                {creationPourSupersede === r.id && (
                  <form onSubmit={(e) => creerResultat(e, r.id)} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, padding: 10, border: `1px solid ${bordure}` }}>
                    <p style={{ fontSize: 12, color: grisTexte, margin: 0 }}>Nouvelle ligne corrigeant {r.id} — {r.id} reste inchangé, jamais écrasé.</p>
                    <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2, width: 100 }}>
                      Devise (optionnel)
                      <input value={formulaire.currency} onChange={(e) => setFormulaire((f) => ({ ...f, currency: e.target.value }))} style={{ padding: 4 }} />
                    </label>
                    <FormulaireMontants cible="revenue" />
                    <FormulaireMontants cible="cost" />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" disabled={creation} style={{ fontSize: 12, padding: "4px 10px", fontWeight: 600 }}>{creation ? "Création…" : "Créer la correction"}</button>
                      <button type="button" onClick={() => setCreationPourSupersede(null)} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Annuler</button>
                    </div>
                    {erreurCreation && <p style={{ fontSize: 12, color: rouge, margin: 0 }}>{erreurCreation}</p>}
                  </form>
                )}
              </>
            )}
          </div>
        );
      })}

      <button
        onClick={() => { setAfficherCreationLibre((v) => !v); setFormulaire(videFormulaire()); }}
        style={{ padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer" }}
      >
        {afficherCreationLibre ? "Annuler" : "+ Nouveau résultat financier"}
      </button>
      {afficherCreationLibre && (
        <form onSubmit={(e) => creerResultat(e)} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, padding: 10, border: `1px solid ${bordure}`, maxWidth: 560 }}>
          <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2, width: 100 }}>
            Devise (optionnel, sinon celle de la mission)
            <input value={formulaire.currency} onChange={(e) => setFormulaire((f) => ({ ...f, currency: e.target.value }))} style={{ padding: 4 }} />
          </label>
          <FormulaireMontants cible="revenue" />
          <FormulaireMontants cible="cost" />
          <button type="submit" disabled={creation} style={{ fontSize: 12, padding: "4px 10px", fontWeight: 600, width: "fit-content" }}>{creation ? "Création…" : "Créer"}</button>
          {erreurCreation && <p style={{ fontSize: 12, color: rouge, margin: 0 }}>{erreurCreation}</p>}
        </form>
      )}
    </div>
  );
}
