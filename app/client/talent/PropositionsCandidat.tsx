"use client";

import { useEffect, useState } from "react";
import { bordure, grisTexte } from "@/lib/theme";
import { Card, EmptyState, Badge, Bouton } from "@/components/client/primitives";
import type { BadgeVariant } from "@/components/client/primitives";

// ATLAS CANDIDATE PROPOSAL — UI CLIENT (A36.1, voir rapport A36.0 §8/§12).
// Réutilise exclusivement components/client/primitives.tsx (même discipline
// que SelectionEtEntretiens.tsx) — aucun nouveau token, aucun Modal/Dialog.
// Consomme EXCLUSIVEMENT les 3 routes CandidateProposal Client déjà
// existantes (lister/accepter/refuser). BROUILLON n'est jamais renvoyé par
// GET (filtré serveur) — jamais reproduit ni supposé ici. L'identité du
// décideur reste celle de la session côté serveur (jamais envoyée par ce
// composant). La création de Mission après acceptation est hors périmètre
// de ce lot (A36.0 §11).

type CandidateProposalStatut = "BROUILLON" | "EMISE" | "ACCEPTEE" | "REFUSEE" | "RETIREE";

type CandidateProposal = {
  id: string;
  statut: CandidateProposalStatut;
  tjmPropose: number | null;
  devise: string | null;
  dureeJours: number | null;
  dateDebutEnvisagee: string | null;
  dateValidite: string | null;
  decideLe: string | null;
  decideParEmail: string | null;
  communiqueParClientHorsSysteme: boolean;
  canalHorsSysteme: string | null;
  retireeLe: string | null;
  createdAt: string;
};

const LABEL_STATUT: Record<CandidateProposalStatut, string> = {
  BROUILLON: "Brouillon",
  EMISE: "En attente de votre décision",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  RETIREE: "Retirée",
};

const VARIANT_STATUT: Record<CandidateProposalStatut, BadgeVariant> = {
  BROUILLON: "neutral",
  EMISE: "info",
  ACCEPTEE: "success",
  REFUSEE: "error",
  RETIREE: "neutral",
};

export default function PropositionsCandidat({ demandeId }: { demandeId: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [propositions, setPropositions] = useState<CandidateProposal[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ id: string; action: "ACCEPTEE" | "REFUSEE" } | null>(null);

  // A36.9 — `reinitialiserErreur` par défaut à true préserve le
  // comportement existant (ouverture du panneau, succès d'une décision) :
  // un rechargement efface l'erreur précédente avant de recharger. Le seul
  // appelant qui passe `false` est le chemin d'échec de decider() ci-
  // dessous — il vient juste de définir le message d'erreur réel (409,
  // ConflitTransitionError, etc.) et ne doit pas le voir écrasé par ce
  // rechargement avant même qu'il n'ait pu être peint (voir rapport A36.8
  // §5 pour le diagnostic du défaut : sans ce paramètre, les deux
  // setErreur() consécutifs — le vrai message puis ce null — sont
  // regroupés par React dans un seul rendu, et le message n'est jamais
  // affiché). Si le rechargement lui-même échoue, son propre setErreur
  // plus bas (ligne inchangée) prend le relais normalement.
  async function charger(options?: { reinitialiserErreur?: boolean }) {
    const reinitialiserErreur = options?.reinitialiserErreur ?? true;
    setChargement(true);
    if (reinitialiserErreur) setErreur(null);
    const reponse = await fetch(`/api/client/talent-selection/demandes/${demandeId}/candidate-proposals`);
    setChargement(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Impossible de charger les propositions commerciales.");
      return;
    }
    const d = await reponse.json();
    setPropositions(d.propositions ?? []);
  }

  useEffect(() => {
    if (ouvert) charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  // Jamais de mise à jour optimiste du statut : sur succès ET sur échec, on
  // recharge systématiquement depuis le serveur — c'est la seule manière de
  // ne jamais considérer une proposition acceptée (ou tout autre état) sans
  // confirmation serveur, y compris lorsque l'état a changé entre le
  // chargement de la page et le clic (conflit de concurrence, double-clic,
  // réponse tardive).
  async function decider(proposalId: string, decision: "ACCEPTEE" | "REFUSEE") {
    setErreur(null);
    setResultat(null);
    setActionEnCours(proposalId);
    const chemin = decision === "ACCEPTEE" ? "accepter" : "refuser";
    const reponse = await fetch(`/api/client/talent-selection/demandes/${demandeId}/candidate-proposals/${proposalId}/${chemin}`, {
      method: "POST",
    });
    setActionEnCours(null);
    setConfirmation(null);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Action impossible — l'état de cette proposition a peut-être changé depuis le chargement de la page.");
      await charger({ reinitialiserErreur: false });
      return;
    }
    setResultat(decision === "ACCEPTEE" ? "Proposition acceptée." : "Proposition refusée.");
    await charger();
  }

  if (!ouvert) {
    return (
      <Bouton variant="secondary" onClick={() => setOuvert(true)}>
        Propositions commerciales
      </Bouton>
    );
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Propositions commerciales</p>
        <Bouton variant="secondary" onClick={() => setOuvert(false)}>
          Fermer
        </Bouton>
      </div>

      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 8px" }}>{erreur}</p>}
      {resultat && <p style={{ color: "#2e7d32", fontSize: 13, margin: "0 0 8px" }}>{resultat}</p>}
      {chargement && <EmptyState message="Chargement…" />}

      {!chargement && propositions && propositions.length === 0 && <EmptyState message="Aucune proposition commerciale pour l'instant." />}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(propositions ?? []).map((p) => (
          <Card key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                {p.tjmPropose != null ? (
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {p.tjmPropose} {p.devise}/jour · {p.dureeJours} jour(s)
                  </p>
                ) : (
                  <p style={{ margin: 0, color: grisTexte }}>Proposition non encore émise</p>
                )}
                {p.dateDebutEnvisagee && (
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
                    Début envisagé : {new Date(p.dateDebutEnvisagee).toLocaleDateString("fr-FR")}
                  </p>
                )}
                {p.dateValidite && (
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
                    Valable jusqu&apos;au {new Date(p.dateValidite).toLocaleDateString("fr-FR")}
                  </p>
                )}
              </div>
              <Badge variant={VARIANT_STATUT[p.statut]}>{LABEL_STATUT[p.statut]}</Badge>
            </div>

            {p.statut === "EMISE" && (
              <div style={{ marginTop: 10 }}>
                {confirmation?.id === p.id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: grisTexte }}>
                      Confirmer {confirmation.action === "ACCEPTEE" ? "l'acceptation" : "le refus"} de cette proposition ? Cette décision est
                      définitive.
                    </span>
                    <Bouton onClick={() => decider(p.id, confirmation.action)} disabled={actionEnCours === p.id}>
                      {actionEnCours === p.id ? "…" : "Confirmer"}
                    </Bouton>
                    <Bouton variant="secondary" onClick={() => setConfirmation(null)} disabled={actionEnCours === p.id}>
                      Annuler
                    </Bouton>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Bouton onClick={() => setConfirmation({ id: p.id, action: "ACCEPTEE" })} disabled={actionEnCours !== null}>
                      Accepter
                    </Bouton>
                    <Bouton variant="secondary" onClick={() => setConfirmation({ id: p.id, action: "REFUSEE" })} disabled={actionEnCours !== null}>
                      Refuser
                    </Bouton>
                  </div>
                )}
              </div>
            )}

            {(p.statut === "ACCEPTEE" || p.statut === "REFUSEE") && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: grisTexte }}>
                Décidé le {p.decideLe ? new Date(p.decideLe).toLocaleDateString("fr-FR") : "—"}
                {p.communiqueParClientHorsSysteme ? ` (communiqué hors système${p.canalHorsSysteme ? ` — ${p.canalHorsSysteme}` : ""})` : ""}
              </p>
            )}

            {p.statut === "RETIREE" && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: grisTexte }}>
                Proposition retirée{p.retireeLe ? ` le ${new Date(p.retireeLe).toLocaleDateString("fr-FR")}` : ""}.
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
