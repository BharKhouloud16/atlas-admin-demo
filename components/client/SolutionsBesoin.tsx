"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Card, EmptyState, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";

// COMPANY ATLAS — V2.1-D : C3 Solution Intelligence — UX Client.
//
// Consomme uniquement l'API Client-safe (V2.1-C/E) — aucune donnée interne
// Talent n'atteint jamais ce composant, la frontière de sécurité est déjà
// appliquée côté serveur (lib/client-solution/adapter.ts). Langage simple,
// aucun jargon IA, aucun score technique affiché — uniquement un niveau de
// certitude qualitatif (voir revue UX validée : "sophistiqué derrière,
// simple devant").

type NiveauConfiance = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

type SolutionVue = {
  id: string;
  niveau: "OPTION" | "RECOMMANDATION" | "DECISION";
  titre: string;
  justification: string;
  competencesCorrespondantes: string[];
  niveauConfiance: NiveauConfiance;
  criteresAPreciser: string[];
  disponibilite: { statut: "CONNUE" | "UNKNOWN"; detail: string | null };
  sourceOptionId: string | null;
  decideParEmail: string | null;
  decideLe: string | null;
  createdAt: string;
};

type ReponseSolutions =
  | { eligible: false; raison: string; options: []; recommandation: null; decisions: [] }
  | { eligible: true; options: SolutionVue[]; recommandation: SolutionVue | null; decisions: SolutionVue[] };

const LABEL_CONFIANCE: Record<NiveauConfiance, string> = {
  HAUTE: "Correspondance forte",
  MOYENNE: "Correspondance partielle",
  BASSE: "Correspondance faible",
  INCONNUE: "À évaluer",
};

const VARIANT_CONFIANCE: Record<NiveauConfiance, BadgeVariant> = {
  HAUTE: "success",
  MOYENNE: "info",
  BASSE: "warning",
  INCONNUE: "neutral",
};

export function SolutionsBesoin({ besoinId, statutBesoin }: { besoinId: string; statutBesoin: string }) {
  const [donnees, setDonnees] = useState<ReponseSolutions | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enDecision, setEnDecision] = useState<string | null>(null);

  function charger() {
    setChargement(true);
    setErreur(null);
    fetch(`/api/client/besoins/${besoinId}/solutions`)
      .then((r) => r.json())
      .then((d) => {
        setDonnees(d);
        setChargement(false);
      })
      .catch(() => {
        setErreur("Impossible de charger les solutions pour le moment.");
        setChargement(false);
      });
  }

  useEffect(() => {
    // 1 — le besoin doit être validé avant que C3 n'ait un sens (même
    // logique que le serveur, voir evaluerEligibiliteBesoin).
    if (statutBesoin !== "VALIDE") return;
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [besoinId, statutBesoin]);

  async function decider(recommandationId: string) {
    setEnDecision(recommandationId);
    setErreur(null);
    const reponse = await fetch(`/api/client/besoins/${besoinId}/solutions/${recommandationId}/decision`, { method: "POST" });
    setEnDecision(null);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(
        reponse.status === 409
          ? "Votre besoin a changé depuis cette recommandation — nous l'avons mise à jour, veuillez consulter la nouvelle proposition."
          : (data.error ?? "Une erreur est survenue.")
      );
      if (reponse.status === 409) charger();
      return;
    }
    charger();
  }

  if (statutBesoin !== "VALIDE") {
    return (
      <EmptyState message="Validez ce besoin pour qu'ATLAS vous propose des solutions." />
    );
  }

  if (chargement) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: grisTexte, margin: 0 }}>
        Recherche de solutions en cours…
      </p>
    );
  }

  if (erreur && !donnees) {
    return <p style={{ fontSize: 13, color: "#c0392b", margin: 0 }}>{erreur}</p>;
  }

  if (!donnees || !donnees.eligible) {
    return <EmptyState message={donnees?.eligible === false ? donnees.raison : "Solutions indisponibles pour l'instant."} />;
  }

  const derniereDecision = donnees.decisions[0] ?? null;
  const alternatives = donnees.recommandation
    ? donnees.options.filter((o) => o.id !== donnees.recommandation!.sourceOptionId)
    : donnees.options;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {erreur && <p style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{erreur}</p>}

      {derniereDecision && (
        <Card style={{ background: "#f4faf6", borderColor: "#bfe3cc" }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Solution choisie</strong> — {derniereDecision.titre}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>
            Décidé le {new Date(derniereDecision.decideLe!).toLocaleDateString("fr-FR")}
          </p>
        </Card>
      )}

      {donnees.options.length === 0 && (
        <EmptyState message="Aucune solution identifiée pour l'instant — nous continuons d'affiner votre besoin." />
      )}

      {donnees.recommandation && (
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Recommandation ATLAS</p>
          <Card style={{ background: "#f8fafd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{donnees.recommandation.titre}</p>
              <Badge variant={VARIANT_CONFIANCE[donnees.recommandation.niveauConfiance]}>
                {LABEL_CONFIANCE[donnees.recommandation.niveauConfiance]}
              </Badge>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: grisTexte }}>{donnees.recommandation.justification}</p>

            {donnees.recommandation.criteresAPreciser.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, textTransform: "uppercase", color: "#888" }}>Encore à préciser</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: grisTexte }}>
                  {donnees.recommandation.criteresAPreciser.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <Bouton onClick={() => decider(donnees.recommandation!.id)} disabled={enDecision === donnees.recommandation.id}>
                {enDecision === donnees.recommandation.id ? "Enregistrement…" : "Choisir cette solution"}
              </Bouton>
            </div>
          </Card>
        </div>
      )}

      {alternatives.length > 0 && (
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>
            {donnees.recommandation ? "Autres options" : "Options possibles"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {alternatives.map((option) => (
              <Card key={option.id} style={{ padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{option.titre}</p>
                  <Badge variant={VARIANT_CONFIANCE[option.niveauConfiance]}>{LABEL_CONFIANCE[option.niveauConfiance]}</Badge>
                </div>
                {option.justification && <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>{option.justification}</p>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
