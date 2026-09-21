"use client";

import { useEffect, useState } from "react";
import { grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 5 — UX,
// 21/09/2026).
//
// Panneau Préférences partagé Client/Admin (règle #12 : individuelle via
// User.id des deux côtés, même modèle PreferenceNotification) — un seul
// composant paramétré par `apiUrl` plutôt qu'une copie par rôle. Jamais
// utilisé côté Ingénieur (aucune UX Ingénieur pour ce lot, mandat explicite).
type AttentionCategorie = "ACTION_REQUISE" | "ALERTE" | "INFORMATION" | "RECOMMANDATION";

const TOUTES_CATEGORIES: { valeur: AttentionCategorie; label: string }[] = [
  { valeur: "ACTION_REQUISE", label: "Action requise" },
  { valeur: "ALERTE", label: "Alerte" },
  { valeur: "INFORMATION", label: "Information" },
  { valeur: "RECOMMANDATION", label: "Recommandation" },
];

export function PreferenceNotificationPanel({ apiUrl }: { apiUrl: string }) {
  const [emailActif, setEmailActif] = useState(true);
  const [categoriesEmail, setCategoriesEmail] = useState<AttentionCategorie[]>([]);
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setEmailActif(d.emailActif ?? true);
        setCategoriesEmail(d.categoriesEmail ?? []);
        setChargement(false);
      })
      .catch(() => setChargement(false));
  }, [apiUrl]);

  async function enregistrer(donnees: { emailActif?: boolean; categoriesEmail?: AttentionCategorie[] }) {
    setEnregistrement(true);
    setErreur(null);
    const reponse = await fetch(apiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(donnees),
    });
    setEnregistrement(false);
    if (!reponse.ok) {
      setErreur("Impossible d'enregistrer vos préférences pour l'instant.");
      return;
    }
    const d = await reponse.json();
    setEmailActif(d.emailActif);
    setCategoriesEmail(d.categoriesEmail);
  }

  function basculerEmailActif() {
    const valeur = !emailActif;
    setEmailActif(valeur);
    enregistrer({ emailActif: valeur });
  }

  function basculerCategorie(cat: AttentionCategorie) {
    const nouvelles = categoriesEmail.includes(cat) ? categoriesEmail.filter((c) => c !== cat) : [...categoriesEmail, cat];
    setCategoriesEmail(nouvelles);
    enregistrer({ categoriesEmail: nouvelles });
  }

  if (chargement) return null;

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Préférences de notification par email</p>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: emailActif ? 8 : 0, cursor: "pointer" }}>
        <input type="checkbox" checked={emailActif} onChange={basculerEmailActif} />
        Recevoir des emails de notification
      </label>
      {emailActif && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginLeft: 4 }}>
          {TOUTES_CATEGORIES.map((c) => (
            <label key={c.valeur} style={{ display: "flex", alignItems: "center", gap: 5, color: grisTexte, cursor: "pointer" }}>
              <input type="checkbox" checked={categoriesEmail.includes(c.valeur)} onChange={() => basculerCategorie(c.valeur)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
      {enregistrement && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: grisTexte }} aria-live="polite">
          Enregistrement…
        </p>
      )}
      {erreur && (
        <p role="alert" style={{ margin: "6px 0 0", fontSize: 11, color: rouge }}>
          {erreur}
        </p>
      )}
    </div>
  );
}
