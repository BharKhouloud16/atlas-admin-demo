"use client";

import { useEffect, useState } from "react";
import { Section, EmptyState } from "@/components/client/primitives";
import FeuillesATraiter, { FeuillesValidees, type FeuilleClient } from "@/components/client/FeuillesATraiter";

// LOT 1 — Client Workspace Foundation (15/09/2026) : rubrique "Finance",
// extraite de l'ancien dashboard (app/client/page.tsx) — même appel API
// (GET /api/feuilles-de-temps, inchangé). La réponse contient déjà les CRA
// ValideeAdmin (à valider) ET ValideeClient (déjà validées) — seule la
// première moitié était affichée jusqu'ici ; l'historique n'est pas une
// nouvelle donnée, seulement un affichage de plus sur la même réponse.

export default function FinanceClientPage() {
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
  );
}
