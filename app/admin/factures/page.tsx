"use client";

import { useEffect, useState } from "react";
import { bleu, bleuFonce, grisTexte, vert, orange, rouge } from "@/lib/theme";
import { LABEL_STATUT_CRA, libelleMois, type StatutCra } from "@/lib/feuilles-de-temps";
import { LABEL_STATUT_FACTURE, statutAffiche } from "@/lib/billing/etat-facture";
import type { StatutFacture } from "@prisma/client";

// COMPANY ATLAS — V2.2-B : Billing Foundation — capacité Admin minimale.
//
// Le mandat CEO V2.2-B section 19 déconseille explicitement "un monstre
// administratif" tout en exigeant une fonctionnalité réellement utilisable
// de bout en bout : cette page reste volontairement au minimum nécessaire
// — créer une Facture depuis un CRA ValideeClient, la faire progresser
// (valider/envoyer/annuler), et constater un paiement. Aucune UI
// d'édition libre des montants (ils sont gelés, voir lib/billing/creation.ts
// et lib/billing/transitions.ts) — jamais une seconde source de vérité sur
// le montant d'une Facture. Style inline, comme le reste de l'Admin (les
// primitives components/client/primitives.tsx restent réservées à l'Espace
// Client, voir leur commentaire d'en-tête).
type Paiement = { id: string; montant: string | number; devise: string; datePaiement: string; methode: string; reference: string; statut: string };
type Facture = {
  id: string;
  numeroFacture: string;
  statut: StatutFacture;
  montantTTC: string | number;
  devise: string;
  dateEcheance: string | null;
  feuilleDeTempsId: string;
  motifAnnulation: string | null;
  client: { nom: string };
  mission: { repere: string | null };
  paiements: Paiement[];
};
type Feuille = {
  id: string;
  mois: string;
  joursTravailles: number;
  statut: StatutCra;
  mission: { repere: string | null; client: { nom: string }; profil: { nom: string } };
};

const COULEUR_STATUT: Record<string, string> = {
  BROUILLON: grisTexte,
  VALIDEE: bleu,
  ENVOYEE: bleu,
  ECHUE: rouge,
  PARTIELLEMENT_PAYEE: orange,
  PAYEE: vert,
  ANNULEE: grisTexte,
};

function nombre(v: string | number): number {
  return typeof v === "number" ? v : parseFloat(v);
}

function solde(f: Facture): number {
  const paye = f.paiements.filter((p) => p.statut === "CONFIRME").reduce((s, p) => s + nombre(p.montant), 0);
  return nombre(f.montantTTC) - paye;
}

// V2.2-C (mandat CEO section 16, "rechercher ; filtrer ; ... identifier les
// anomalies") — recherche/filtre appliqués côté client sur la liste déjà
// chargée (pas de nouvelle route : la volumétrie de ce dépôt ne justifie
// pas une pagination/recherche serveur, voir mandat section 23 "pas
// d'optimisation prématurée" — à revoir si le volume réel de Factures le
// justifie un jour).
const FILTRES_STATUT: { valeur: string; label: string }[] = [
  { valeur: "TOUS", label: "Tous les statuts" },
  { valeur: "BROUILLON", label: LABEL_STATUT_FACTURE.BROUILLON },
  { valeur: "VALIDEE", label: LABEL_STATUT_FACTURE.VALIDEE },
  { valeur: "ENVOYEE", label: LABEL_STATUT_FACTURE.ENVOYEE },
  { valeur: "ECHUE", label: LABEL_STATUT_FACTURE.ECHUE },
  { valeur: "PARTIELLEMENT_PAYEE", label: LABEL_STATUT_FACTURE.PARTIELLEMENT_PAYEE },
  { valeur: "PAYEE", label: LABEL_STATUT_FACTURE.PAYEE },
  { valeur: "ANNULEE", label: LABEL_STATUT_FACTURE.ANNULEE },
];

export default function FacturesAdminPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [feuilles, setFeuilles] = useState<Feuille[]>([]);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [paiementForm, setPaiementForm] = useState<Record<string, { montant: string; reference: string; methode: string }>>({});
  const [recherche, setRecherche] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("TOUS");

  function recharger() {
    Promise.all([fetch("/api/factures").then((r) => r.json()), fetch("/api/feuilles-de-temps").then((r) => r.json())]).then(
      ([f, c]) => {
        setFactures(f.factures ?? []);
        setFeuilles(c.feuilles ?? []);
        setChargement(false);
      }
    );
  }
  useEffect(recharger, []);

  async function creerFacture(feuilleDeTempsId: string) {
    setEnCours(feuilleDeTempsId);
    await fetch("/api/factures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feuilleDeTempsId }),
    });
    setEnCours(null);
    recharger();
  }

  async function transitionner(id: string, action: "valider" | "envoyer" | "annuler") {
    const motif = action === "annuler" ? window.prompt("Motif d'annulation :") : undefined;
    if (action === "annuler" && !motif) return;
    setEnCours(id + action);
    await fetch(`/api/factures/${id}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, motif }),
    });
    setEnCours(null);
    recharger();
  }

  async function enregistrerPaiement(id: string) {
    const saisie = paiementForm[id];
    if (!saisie?.montant || !saisie?.reference || !saisie?.methode) return;
    setEnCours(id + "paiement");
    await fetch(`/api/factures/${id}/paiements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        montant: Number(saisie.montant),
        devise: factures.find((f) => f.id === id)?.devise,
        reference: saisie.reference,
        methode: saisie.methode,
      }),
    });
    setEnCours(null);
    setPaiementForm((prev) => ({ ...prev, [id]: { montant: "", reference: "", methode: "" } }));
    recharger();
  }

  // V2.2-D (mandat CEO section 16, "corriger selon règles autorisées") —
  // seule correction possible sur un paiement déjà enregistré : l'annuler
  // (lib/billing/paiement.ts annulerPaiement()). Jamais une édition du
  // montant/de la référence — le paiement d'origine reste lisible tel
  // quel, exactement comme motifAnnulation sur Facture.
  async function annulerUnPaiement(factureId: string, paiementId: string) {
    if (!window.confirm("Annuler ce paiement ? Le solde de la facture sera recalculé.")) return;
    setEnCours(paiementId + "annulerPaiement");
    await fetch(`/api/factures/${factureId}/paiements/${paiementId}`, { method: "PATCH" });
    setEnCours(null);
    recharger();
  }

  if (chargement) return <div>Chargement...</div>;

  const facturables = feuilles.filter(
    (f) => f.statut === "ValideeClient" && !factures.some((fa) => fa.feuilleDeTempsId === f.id)
  );

  const facturesAvecStatutAffiche = factures.map((f) => ({
    facture: f,
    statutAff: statutAffiche(f.statut, f.dateEcheance ? new Date(f.dateEcheance) : null),
  }));
  const enRetard = facturesAvecStatutAffiche.filter((x) => x.statutAff === "ECHUE");

  const termeRecherche = recherche.trim().toLowerCase();
  const facturesAffichees = facturesAvecStatutAffiche.filter(({ facture: f, statutAff }) => {
    if (filtreStatut !== "TOUS" && statutAff !== filtreStatut) return false;
    if (!termeRecherche) return true;
    return (
      f.numeroFacture.toLowerCase().includes(termeRecherche) ||
      f.client.nom.toLowerCase().includes(termeRecherche) ||
      (f.mission.repere ?? "").toLowerCase().includes(termeRecherche)
    );
  });

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Facturation</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 24, maxWidth: 700 }}>
        Créez une facture depuis un CRA validé par le client, faites-la progresser (validation → envoi), puis
        constatez les paiements reçus. Les montants sont gelés à la création à partir du CRA et ne sont jamais
        modifiables ici.
      </p>

      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        CRA facturables ({facturables.length})
      </p>
      {facturables.length === 0 && <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Aucun CRA validé en attente de facturation.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {facturables.map((f) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
            <span style={{ fontSize: 13 }}>
              {f.mission.profil.nom} — {f.mission.repere ?? f.mission.client.nom} ({f.mission.client.nom}) · {libelleMois(f.mois)} · {f.joursTravailles} j
              <span style={{ marginLeft: 8, color: "#888" }}>{LABEL_STATUT_CRA[f.statut]}</span>
            </span>
            <button
              onClick={() => creerFacture(f.id)}
              disabled={enCours === f.id}
              style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              Créer la facture
            </button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Factures ({factures.length})</p>

      {enRetard.length > 0 && (
        <div style={{ background: "#fdf1f0", border: `1px solid ${rouge}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: rouge, fontWeight: 600 }}>
          {enRetard.length} facture{enRetard.length > 1 ? "s" : ""} en retard de paiement (échéance dépassée)
        </div>
      )}

      {factures.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Rechercher (numéro, client, mission)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ fontSize: 13, padding: "7px 10px", border: "1px solid #e4e7ee", borderRadius: 6, width: 260 }}
          />
          <select
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value)}
            style={{ fontSize: 13, padding: "7px 10px", border: "1px solid #e4e7ee", borderRadius: 6 }}
          >
            {FILTRES_STATUT.map((opt) => (
              <option key={opt.valeur} value={opt.valeur}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {factures.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune facture créée pour l&apos;instant.</p>}
      {factures.length > 0 && facturesAffichees.length === 0 && (
        <p style={{ fontSize: 13, color: "#888" }}>Aucune facture ne correspond à cette recherche/ce filtre.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {facturesAffichees.map(({ facture: f, statutAff }) => {
          const restant = solde(f);
          return (
            <div key={f.id} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                    {f.numeroFacture} — {f.client.nom}
                    {f.mission.repere ? ` (${f.mission.repere})` : ""}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5567" }}>
                    {nombre(f.montantTTC).toFixed(2)} {f.devise} TTC · reste dû {restant.toFixed(2)} {f.devise}
                  </p>
                  {f.motifAnnulation && <p style={{ margin: "4px 0 0", fontSize: 12, color: rouge }}>Motif d&apos;annulation : {f.motifAnnulation}</p>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: COULEUR_STATUT[statutAff] ?? grisTexte }}>
                    {LABEL_STATUT_FACTURE[statutAff]}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {f.statut === "BROUILLON" && (
                      <button onClick={() => transitionner(f.id, "valider")} disabled={enCours === f.id + "valider"} style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                        Valider
                      </button>
                    )}
                    {f.statut === "VALIDEE" && (
                      <button onClick={() => transitionner(f.id, "envoyer")} disabled={enCours === f.id + "envoyer"} style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                        Envoyer
                      </button>
                    )}
                    {["BROUILLON", "VALIDEE", "ENVOYEE", "PARTIELLEMENT_PAYEE"].includes(f.statut) && (
                      <button onClick={() => transitionner(f.id, "annuler")} disabled={enCours === f.id + "annuler"} style={{ fontSize: 12, padding: "6px 12px", color: rouge, borderColor: rouge }}>
                        Annuler
                      </button>
                    )}
                    <a href={`/api/factures/${f.id}/document`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, alignSelf: "center" }}>
                      PDF
                    </a>
                  </div>
                </div>
              </div>

              {f.paiements.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: grisTexte, textTransform: "uppercase" }}>Paiements</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {f.paiements.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 8 }}>
                        <span style={{ color: p.statut === "ANNULE" ? "#94a0b3" : grisTexte, textDecoration: p.statut === "ANNULE" ? "line-through" : "none" }}>
                          {new Date(p.datePaiement).toLocaleDateString("fr-FR")} · {nombre(p.montant).toFixed(2)} {p.devise} · {p.methode} · réf. {p.reference}
                          {p.statut === "ANNULE" && " (annulé)"}
                        </span>
                        {p.statut === "CONFIRME" && (
                          <button
                            onClick={() => annulerUnPaiement(f.id, p.id)}
                            disabled={enCours === p.id + "annulerPaiement"}
                            style={{ fontSize: 11, padding: "3px 8px", color: rouge, background: "transparent", border: `1px solid ${rouge}`, borderRadius: 4, cursor: "pointer" }}
                          >
                            Annuler
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(f.statut === "ENVOYEE" || f.statut === "PARTIELLEMENT_PAYEE") && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`Montant (${f.devise})`}
                    value={paiementForm[f.id]?.montant ?? ""}
                    onChange={(e) => setPaiementForm((prev) => ({ ...prev, [f.id]: { ...prev[f.id], montant: e.target.value, reference: prev[f.id]?.reference ?? "", methode: prev[f.id]?.methode ?? "" } }))}
                    style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e4e7ee", borderRadius: 4, width: 130 }}
                  />
                  <input
                    type="text"
                    placeholder="Référence"
                    value={paiementForm[f.id]?.reference ?? ""}
                    onChange={(e) => setPaiementForm((prev) => ({ ...prev, [f.id]: { ...prev[f.id], reference: e.target.value, montant: prev[f.id]?.montant ?? "", methode: prev[f.id]?.methode ?? "" } }))}
                    style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e4e7ee", borderRadius: 4, width: 140 }}
                  />
                  <input
                    type="text"
                    placeholder="Méthode (virement...)"
                    value={paiementForm[f.id]?.methode ?? ""}
                    onChange={(e) => setPaiementForm((prev) => ({ ...prev, [f.id]: { ...prev[f.id], methode: e.target.value, montant: prev[f.id]?.montant ?? "", reference: prev[f.id]?.reference ?? "" } }))}
                    style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e4e7ee", borderRadius: 4, width: 150 }}
                  />
                  <button
                    onClick={() => enregistrerPaiement(f.id)}
                    disabled={enCours === f.id + "paiement"}
                    style={{ fontSize: 12, padding: "6px 12px", background: vert, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    Enregistrer le paiement
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
