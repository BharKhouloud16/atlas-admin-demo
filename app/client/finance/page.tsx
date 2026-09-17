"use client";

import { useEffect, useState } from "react";
import { Section, EmptyState, Tabs } from "@/components/client/primitives";
import FeuillesATraiter, { FeuillesValidees, type FeuilleClient } from "@/components/client/FeuillesATraiter";
import { FacturesClient } from "@/components/client/FacturesClient";

// LOT 1 — Client Workspace Foundation (15/09/2026) : rubrique "Finance",
// extraite de l'ancien dashboard (app/client/page.tsx) — même appel API
// (GET /api/feuilles-de-temps, inchangé). La réponse contient déjà les CRA
// ValideeAdmin (à valider) ET ValideeClient (déjà validées) — seule la
// première moitié était affichée jusqu'ici ; l'historique n'est pas une
// nouvelle donnée, seulement un affichage de plus sur la même réponse.
//
// V2.2-B — Billing Foundation (17/09/2026) : ajout d'un onglet
// "Facturation" (mandat CEO V2.2-B section 19 — FACTURES/PAIEMENTS/SOLDE/
// ÉCHÉANCES doivent être visibles depuis /client/finance). Choix de
// composition : Tabs plutôt qu'un empilement de Sections supplémentaires —
// la page contenait déjà deux Sections CRA ; ajouter Factures/Paiements en
// dur au même niveau aurait produit une page longue mélangeant deux sujets
// (facturation vs. validation de temps travaillé) sans hiérarchie. Onglet
// "Facturation" par défaut : c'est la raison principale pour laquelle un
// Client visite /client/finance (voir nom de la rubrique).
export default function FinanceClientPage() {
  const [onglet, setOnglet] = useState("facturation");
  const [feuilles, setFeuilles] = useState<FeuilleClient[]>([]);
  const [chargement, setChargement] = useState(true);

  function recharger() {
    fetch("/api/feuilles-de-temps")
      .then((r) => r.json())
      .then((d) => {
        setFeuilles(d.feuilles ?? []);
        setChargement(false);
      });
  }

  useEffect(() => {
    recharger();
  }, []);

  const aValider = feuilles.filter((f) => f.statut === "ValideeAdmin");
  const validees = feuilles.filter((f) => f.statut === "ValideeClient");

  return (
    <div>
      <Tabs
        tabs={[
          { id: "facturation", label: "Facturation" },
          { id: "temps", label: "Feuilles de temps", badge: aValider.length },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />

      {onglet === "facturation" && <FacturesClient />}

      {onglet === "temps" && (
        <div>
          <Section title={`Feuilles de temps à valider${aValider.length ? ` (${aValider.length})` : ""}`}>
            {chargement && <EmptyState message="Chargement…" />}
            {!chargement && aValider.length === 0 && <EmptyState message="Aucune feuille de temps en attente de votre validation." />}
            <FeuillesATraiter feuilles={aValider} recharger={recharger} />
          </Section>

          <Section title="Historique validé">
            {!chargement && validees.length === 0 && <EmptyState message="Aucune feuille de temps validée pour l'instant." />}
            <FeuillesValidees feuilles={validees} />
          </Section>
        </div>
      )}
    </div>
  );
}
