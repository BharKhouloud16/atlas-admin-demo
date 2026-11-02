// LOT 7 (01/11/2026) — pictogrammes de la planche (navigation, indicateurs),
// dessinés en SVG simple (trait 1,8 px, couleur héritée), sans bibliothèque
// externe. Toujours décoratifs : aria-hidden, le libellé texte porte le sens.

import type { ReactElement } from "react";

export type NomIcone =
  | "accueil"
  | "notifications"
  | "besoins"
  | "talents"
  | "projets"
  | "missions"
  | "atlasos"
  | "resultats"
  | "documents"
  | "communication"
  | "finance"
  | "entreprise"
  | "veille"
  | "taches"
  | "plus";

const TRACES: Record<NomIcone, ReactElement> = {
  accueil: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  notifications: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  besoins: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  talents: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5a3 3 0 0 1 0 5.8M18 14.8c1.8.6 3 2.4 3 5.2" />
    </>
  ),
  projets: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18" />
    </>
  ),
  missions: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  atlasos: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h6v6H9zM9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </>
  ),
  resultats: <path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" />,
  documents: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  communication: <path d="M4 5h16v11H9l-5 4z" />,
  finance: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  entreprise: (
    <>
      <path d="M4 21V7l8-4 8 4v14" />
      <path d="M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01" />
    </>
  ),
  veille: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  taches: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  plus: (
    <>
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
    </>
  ),
};

export function Icone({ nom, taille = 18 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {TRACES[nom]}
    </svg>
  );
}
