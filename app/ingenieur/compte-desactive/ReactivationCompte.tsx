"use client";

import { useState } from "react";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";
import { bleu, bleuFonce, grisTexte, bordure, rouge } from "@/lib/theme";

export default function ReactivationCompte() {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  async function reactiver() {
    setEnvoi(true);
    setErreur("");
    try {
      const reponse = await fetch("/api/ingenieur/compte/reactiver", { method: "POST" });
      const data = await reponse.json().catch(() => null);
      if (!reponse.ok || data?.ok !== true) {
        setErreur("Votre profil n'a pas pu être réactivé. Merci de réessayer dans quelques instants.");
        setEnvoi(false);
        return;
      }
      // Navigation complète : le middleware doit relire le nouveau cookie de
      // session (desactive=false) émis par l'API. /ingenieur applique ensuite
      // les étapes normales du profil (CV, validation, disponibilité).
      window.location.assign("/ingenieur");
    } catch {
      setErreur("Impossible de contacter le serveur. Vérifiez votre connexion puis réessayez.");
      setEnvoi(false);
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8, color: bleuFonce }}>Profil désactivé</h1>
      <p style={{ fontSize: 14, color: grisTexte, marginBottom: 24 }}>
        Vous avez désactivé temporairement votre profil : il n&apos;est plus proposé aux clients et votre espace est
        en pause. Vos informations sont conservées. Vous pouvez le réactiver à tout moment.
      </p>
      <div style={{ border: `1px solid ${bordure}`, borderRadius: 10, padding: 20 }}>
        <button
          type="button"
          onClick={reactiver}
          disabled={envoi}
          style={{ background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
        >
          {envoi ? "Réactivation en cours..." : "Réactiver mon profil"}
        </button>
        {erreur && (
          <p role="alert" style={{ color: rouge, fontSize: 13, margin: "12px 0 0" }}>
            {erreur}
          </p>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <BoutonDeconnexion />
      </div>
    </main>
  );
}
