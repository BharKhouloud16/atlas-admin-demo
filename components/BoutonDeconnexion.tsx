"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bleuFonce, bordure } from "@/lib/theme";

// Bouton de déconnexion réutilisé dans les 3 espaces (admin, ingénieur,
// client) — jusqu'ici absent partout, il n'existait aucun moyen de se
// déconnecter autrement qu'en vidant les cookies manuellement.
export default function BoutonDeconnexion({ style }: { style?: React.CSSProperties }) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);

  async function deconnecter() {
    setEnvoi(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/connexion");
    router.refresh();
  }

  return (
    <button
      onClick={deconnecter}
      disabled={envoi}
      style={{
        background: "#fff",
        color: bleuFonce,
        border: `1px solid ${bordure}`,
        fontWeight: 600,
        fontSize: 13,
        padding: "8px 14px",
        ...style,
      }}
    >
      {envoi ? "..." : "Se déconnecter"}
    </button>
  );
}
