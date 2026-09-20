"use client";

import { useEffect, useState } from "react";
import { grisTexte, vert } from "@/lib/theme";
import { Section, EmptyState, Badge, Bouton, Table, MoneyDisplay, StatTile, type BadgeVariant } from "@/components/client/primitives";
import type { FactureClientSafe, VarianteStatutFacture } from "@/lib/billing/adapter";

// COMPANY ATLAS — V2.2-B : Billing Foundation — UX Client.
//
// Consomme exclusivement l'API Client-safe (GET /api/factures — voir
// lib/billing/adapter.ts) : aucune donnée financière interne (coût,
// marge, contexte fiscal brut) n'atteint jamais ce composant, la frontière
// de sécurité est déjà appliquée côté serveur. Objectif cognitif (mandat
// CEO V2.2-B section 18) : solde/échéance/action compris en quelques
// secondes — jamais l'enum technique affiché, jamais un jargon comptable
// non expliqué.
const VARIANT_BADGE: Record<VarianteStatutFacture, BadgeVariant> = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

function formaterDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function FacturesClient() {
  const [factures, setFactures] = useState<FactureClientSafe[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/factures")
      .then((r) => r.json())
      .then((d) => setFactures(d.factures ?? []))
      .catch(() => setErreur("Impossible de charger vos factures pour le moment."));
  }, []);

  if (erreur) return <p style={{ fontSize: 13, color: "#c0392b" }}>{erreur}</p>;
  if (!factures) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: grisTexte }}>
        Chargement…
      </p>
    );
  }
  if (factures.length === 0) {
    return <EmptyState message="Aucune facture pour l'instant." />;
  }

  // Toutes les devises ne peuvent structurellement pas être additionnées
  // (Mission.deviseVente varie par mission, jamais convertie — voir audit
  // V2.2-A, tests/api/facturation-devise.spec.ts) : le résumé se limite à
  // la devise la plus fréquente parmi les factures ouvertes, jamais une
  // conversion inventée. Si plusieurs devises coexistent, chaque montant
  // reste affiché avec la sienne dans la liste ci-dessous — jamais une
  // somme mélangeant des devises différentes.
  const ouvertes = factures.filter((f) => f.solde > 0 && f.statut !== "Annulée");
  const deviseDominante = ouvertes[0]?.devise ?? factures[0]?.devise ?? "EUR";
  const soldeTotal = ouvertes.filter((f) => f.devise === deviseDominante).reduce((s, f) => s + f.solde, 0);
  const prochaineEcheance = ouvertes
    .map((f) => f.dateEcheance)
    .filter((d): d is string => d !== null)
    .sort()[0];
  const dernierPaiement = factures
    .flatMap((f) => f.paiements.map((p) => ({ ...p })))
    .sort((a, b) => (a.datePaiement < b.datePaiement ? 1 : -1))[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatTile label="Solde à régler">
          <MoneyDisplay montant={soldeTotal} devise={deviseDominante} />
        </StatTile>
        <StatTile label="Prochaine échéance">
          <span style={{ fontSize: 16, fontWeight: 700 }}>{formaterDate(prochaineEcheance ?? null)}</span>
        </StatTile>
        <StatTile label="Factures ouvertes">
          <span style={{ fontSize: 20, fontWeight: 700 }}>{ouvertes.length}</span>
        </StatTile>
        <StatTile label="Dernier paiement">
          {dernierPaiement ? <MoneyDisplay montant={dernierPaiement.montant} devise={dernierPaiement.devise} taille={16} /> : <span style={{ fontSize: 13, color: "#94a0b3" }}>—</span>}
        </StatTile>
      </div>

      {ouvertes.length > 0 && (
        <Section title="À régler" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ouvertes.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e4e7ee", borderRadius: 10, padding: 12, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Facture {f.numeroFacture}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>Échéance : {formaterDate(f.dateEcheance)}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <MoneyDisplay montant={f.solde} devise={f.devise} taille={16} />
                  <a href={`/api/factures/${f.id}/document`} target="_blank" rel="noreferrer">
                    <Bouton variant="secondary">Voir</Bouton>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Factures" style={{ marginBottom: 0 }}>
        <Table
          colonnes={[
            { label: "N°" },
            { label: "Statut" },
            { label: "Émise le" },
            { label: "Échéance" },
            { label: "Montant", align: "right" },
            { label: "Payé", align: "right" },
            { label: "Solde", align: "right" },
            { label: "", align: "right" },
          ]}
          cleLigne={(i) => factures[i].id}
          lignes={factures.map((f) => [
            f.numeroFacture,
            <Badge key="statut" variant={VARIANT_BADGE[f.statutVariant]}>
              {f.statut}
            </Badge>,
            formaterDate(f.dateEmission),
            formaterDate(f.dateEcheance),
            <MoneyDisplay key="montant" montant={f.montantTTC} devise={f.devise} taille={13} couleur={grisTexte} />,
            <MoneyDisplay key="paye" montant={f.montantTTC - f.solde} devise={f.devise} taille={13} couleur={vert} />,
            <MoneyDisplay key="solde" montant={f.solde} devise={f.devise} taille={13} />,
            <a key="action" href={`/api/factures/${f.id}/document`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600 }}>
              PDF
            </a>,
          ])}
        />
      </Section>

      {factures.some((f) => f.paiements.length > 0) && (
        <Section title="Paiements récents" style={{ marginBottom: 0 }}>
          <Table
            colonnes={[{ label: "Date" }, { label: "Facture" }, { label: "Méthode" }, { label: "Montant", align: "right" }]}
            cleLigne={(i) => `${i}`}
            lignes={factures
              .flatMap((f) => f.paiements.map((p) => ({ ...p, numeroFacture: f.numeroFacture })))
              .sort((a, b) => (a.datePaiement < b.datePaiement ? 1 : -1))
              .map((p) => [formaterDate(p.datePaiement), p.numeroFacture, p.methode, <MoneyDisplay key="m" montant={p.montant} devise={p.devise} taille={13} couleur={grisTexte} />])}
          />
        </Section>
      )}
    </div>
  );
}
