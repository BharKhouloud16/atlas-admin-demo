"use client";

import { useState } from "react";
import { libelleMois, type StatutCra } from "@/lib/feuilles-de-temps";
import { Card, Bouton, Badge } from "./primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : extrait tel quel de
// app/client/page.tsx (comportement et appel API identiques — PATCH
// /api/feuilles-de-temps {action:"validerClient"}, inchangé) pour être
// réutilisable à la fois sur la nouvelle page Finance (liste complète) et,
// sous une forme condensée, dans le résumé "Actions requises" de la Vue
// d'ensemble.

export type FeuilleClient = {
  id: string;
  mois: string;
  joursTravailles: number;
  heuresSupplementaires: number;
  statut: StatutCra;
  mission: { id: string; repere: string | null; profil: { nom: string } };
};

export default function FeuillesATraiter({
  feuilles,
  recharger,
}: {
  feuilles: FeuilleClient[];
  recharger: () => void;
}) {
  const [envoi, setEnvoi] = useState<string | null>(null);

  async function valider(id: string) {
    setEnvoi(id);
    await fetch("/api/feuilles-de-temps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "validerClient" }),
    });
    setEnvoi(null);
    recharger();
  }

  if (feuilles.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {feuilles.map((f) => (
        <Card key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
              {f.mission.profil.nom} — {f.mission.repere ?? libelleMois(f.mois)}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "#666" }}>
              {libelleMois(f.mois)} · {f.joursTravailles} j
              {f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
            </p>
          </div>
          <Bouton onClick={() => valider(f.id)} disabled={envoi === f.id}>
            {envoi === f.id ? "..." : "Valider"}
          </Bouton>
        </Card>
      ))}
    </div>
  );
}

// Historique des CRA déjà validées par le client (statut ValideeClient) —
// donnée déjà renvoyée par GET /api/feuilles-de-temps mais jusqu'ici jamais
// affichée côté client (seul le filtre "à valider" était exploité). Aucune
// nouvelle requête, seulement un affichage de plus sur la même réponse.
export function FeuillesValidees({ feuilles }: { feuilles: FeuilleClient[] }) {
  if (feuilles.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {feuilles.map((f) => (
        <Card key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
              {f.mission.profil.nom} — {f.mission.repere ?? libelleMois(f.mois)}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "#666" }}>
              {libelleMois(f.mois)} · {f.joursTravailles} j
              {f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
            </p>
          </div>
          <Badge variant="success">Validée</Badge>
        </Card>
      ))}
    </div>
  );
}
