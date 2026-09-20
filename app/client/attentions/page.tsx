"use client";

import { useCallback, useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Section, EmptyState, Bouton, AttentionCard, UnreadBadge, type AttentionCardData } from "@/components/client/primitives";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// Espace Client.
//
// "Centre de notifications" du mandat CEO V2.3 section 12 : le Client doit
// comprendre immédiatement "voici ce qui nécessite mon attention" —
// GET /api/client/attentions trie déjà par priorité (comparerAttentions),
// jamais un tri additionnel ici.

type Reponse = { attentions: AttentionCardData[]; total: number; nonLues: number };

export default function AttentionsClientPage() {
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [historique, setHistorique] = useState(false);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback((voirHistorique: boolean) => {
    setChargement(true);
    fetch(`/api/client/attentions${voirHistorique ? "?historique=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setDonnees(d);
        setChargement(false);
      })
      .catch(() => setChargement(false));
  }, []);

  useEffect(() => {
    charger(historique);
  }, [charger, historique]);

  async function marquerLu(id: string) {
    await fetch(`/api/client/attentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lire" }),
    });
    charger(historique);
  }

  async function resoudre(id: string) {
    await fetch(`/api/client/attentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resoudre" }),
    });
    charger(historique);
  }

  async function toutMarquerLu() {
    await fetch("/api/client/attentions/tout-lire", { method: "POST" });
    charger(historique);
  }

  return (
    <Section
      title="Centre d'attention"
      action={
        donnees && donnees.nonLues > 0 ? (
          <Bouton variant="secondary" onClick={toutMarquerLu}>
            Tout marquer comme lu
          </Bouton>
        ) : undefined
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: grisTexte, cursor: "pointer" }}>
          <input type="checkbox" checked={historique} onChange={(e) => setHistorique(e.target.checked)} />
          Afficher l&apos;historique complet (résolu / expiré)
        </label>
        {donnees && <UnreadBadge count={donnees.nonLues} />}
      </div>

      {chargement && <EmptyState message="Chargement…" />}
      {!chargement && donnees && donnees.attentions.length === 0 && (
        <EmptyState message="Rien ne requiert votre attention pour l'instant." />
      )}
      {!chargement && donnees && donnees.attentions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {donnees.attentions.map((a) => (
            <AttentionCard
              key={a.id}
              attention={a}
              onMarquerLu={a.statut === "OUVERTE" ? () => marquerLu(a.id) : undefined}
              onResoudre={() => resoudre(a.id)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
