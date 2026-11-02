"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bleu } from "@/lib/theme";
import { UnreadBadge } from "@/components/client/primitives";
import { Icone, type NomIcone } from "@/components/client/Icones";

// COMPANY ATLAS — LOT 1 : Client Workspace Foundation (15/09/2026).
//
// Les 10 rubriques cibles de l'Espace Client (voir l'ordre de mission,
// section 3). `disponible: false` = emplacement architectural réservé,
// aucune fonctionnalité réelle derrière (jamais de fausse donnée) — la page
// existe et affiche un état "Bientôt disponible" explicite, elle n'est
// jamais retirée du menu ni désactivée au clic : le client doit toujours
// comprendre que la rubrique existe et savoir où elle sera.
// V2.3 — Communication Intelligence + Attention Center : mandat CEO
// explicite section 12 ("Centre de notifications... le Client doit
// comprendre immédiatement 'voici ce qui nécessite mon attention'"), qui
// justifie une 11e rubrique — dérogation documentée au principe LOT 1
// ("les 10 rubriques cibles") sur mandat CEO direct, jamais une extension
// discrétionnaire du menu.
// LOT 7 (01/11/2026, planche) : libellés et pictogrammes de la planche
// (« Accueil », « Notifications », « Mon entreprise », option ATLAS OS,
// « Actualités & veille » annoncé comme bientôt disponible). Mêmes adresses
// qu'avant : aucune rubrique existante n'est retirée.
const RUBRIQUES: { href: string; label: string; icone: NomIcone; disponible: boolean }[] = [
  { href: "/client", label: "Accueil", icone: "accueil", disponible: true },
  { href: "/client/besoins", label: "Besoins", icone: "besoins", disponible: true },
  { href: "/client/talent", label: "Talents", icone: "talents", disponible: true },
  // LOT 6 (28/10/2026) : projets complets confiés à ATLAS.
  { href: "/client/projets", label: "Projets", icone: "projets", disponible: true },
  { href: "/client/missions", label: "Missions", icone: "missions", disponible: true },
  // LOT 5 (28/10/2026) : module optionnel avec demande d'activation.
  { href: "/client/atlas-os", label: "ATLAS OS", icone: "atlasos", disponible: true },
  { href: "/client/profil", label: "Mon entreprise", icone: "entreprise", disponible: true },
  { href: "/client/resultats", label: "Résultats", icone: "resultats", disponible: true },
  { href: "/client/documents", label: "Documents", icone: "documents", disponible: true },
  { href: "/client/finance", label: "Finance", icone: "finance", disponible: true },
  { href: "/client/communication", label: "Communication", icone: "communication", disponible: true },
  { href: "/client/veille", label: "Actualités & veille", icone: "veille", disponible: false },
  { href: "/client/attentions", label: "Notifications", icone: "notifications", disponible: true },
];

// Barre d'onglets du bas sur mobile (planche, vue 6).
const ONGLETS_MOBILE: { href: string; label: string; icone: NomIcone }[] = [
  { href: "/client", label: "Accueil", icone: "accueil" },
  { href: "/client/besoins", label: "Besoins", icone: "besoins" },
  { href: "/client/talent", label: "Talents", icone: "talents" },
  { href: "/client/projets", label: "Projets", icone: "projets" },
];

// LOT 7 (28/10/2026) — navigation latérale sombre (planche validée). Le
// composant porte aussi la tête (logo) et le pied (e-mail, déconnexion) de la
// barre latérale pour gérer le bouton « Menu » sur mobile ; la mise en page
// responsive est définie dans app/client/layout.tsx (classes `cl-`).
export default function ClientNav({ logo, pied, atlasOsActif = false }: { logo?: ReactNode; pied?: ReactNode; atlasOsActif?: boolean }) {
  const pathname = usePathname();
  const [nonLues, setNonLues] = useState(0);
  const [messagesNonLus, setMessagesNonLus] = useState(0);
  const [menuOuvert, setMenuOuvert] = useState(false);

  // Sur mobile, le menu se referme après chaque navigation.
  useEffect(() => {
    setMenuOuvert(false);
  }, [pathname]);

  // Compteur non-lus chargé à chaque changement de page — même
  // discipline que le reste de l'Espace Client (aucun mécanisme de
  // rafraîchissement en temps réel n'existe ailleurs dans ce dépôt, jamais
  // introduit ici en premier).
  useEffect(() => {
    fetch("/api/client/attentions")
      .then((r) => r.json())
      .then((d) => setNonLues(d.nonLues ?? 0))
      .catch(() => {});
  }, [pathname]);

  // V2.5 — Communication Intelligence (Lot 5, 21/09/2026) : badge distinct
  // pour la messagerie (nonLus, voir GET /api/client/messages) — jamais
  // fusionné avec le compteur Attention ci-dessus.
  useEffect(() => {
    fetch("/api/client/messages")
      .then((r) => r.json())
      .then((d) => setMessagesNonLus(d.nonLus ?? 0))
      .catch(() => {});
  }, [pathname]);

  return (
    <aside className="cl-sidebar">
      <div className="cl-sidebar-tete">
        {logo}
        <button
          type="button"
          className="cl-menu-bouton"
          aria-expanded={menuOuvert}
          aria-controls="cl-nav-zone"
          onClick={() => setMenuOuvert((o) => !o)}
        >
          <span aria-hidden="true">{menuOuvert ? "✕" : "☰"}</span> Menu
        </button>
      </div>
      <span className="cl-espace">Espace Client</span>
      <div id="cl-nav-zone" className="cl-nav-zone" data-ouvert={menuOuvert ? "oui" : "non"}>
        <nav aria-label="Navigation Espace Client" className="cl-nav">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {RUBRIQUES.map((r) => {
              const actif = r.href === "/client" ? pathname === "/client" : pathname?.startsWith(r.href);
              return (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    aria-current={actif ? "page" : undefined}
                    style={{
                      fontSize: 14,
                      fontWeight: actif ? 700 : 500,
                      color: actif ? "#fff" : "#c9d3ea",
                      textDecoration: "none",
                      padding: "9px 12px",
                      borderRadius: 8,
                      background: actif ? "rgba(255,255,255,.12)" : undefined,
                      boxShadow: actif ? `inset 3px 0 0 ${bleu}` : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <Icone nom={r.icone} />
                      {r.label}
                    </span>
                    {r.href === "/client/attentions" && <UnreadBadge count={nonLues} />}
                    {r.href === "/client/communication" && <UnreadBadge count={messagesNonLus} />}
                    {r.href === "/client/atlas-os" && !atlasOsActif && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#2557d6", borderRadius: 6, padding: "1px 6px" }}>Option</span>
                    )}
                    {!r.disponible && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#aebbd8", textTransform: "uppercase" }}>bientôt</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {pied && <div className="cl-pied">{pied}</div>}
      </div>
      <nav aria-label="Navigation rapide" className="cl-onglets">
        {ONGLETS_MOBILE.map((o) => {
          const actif = o.href === "/client" ? pathname === "/client" : pathname?.startsWith(o.href);
          return (
            <Link key={o.href} href={o.href} aria-current={actif ? "page" : undefined} className="cl-onglet">
              <Icone nom={o.icone} taille={20} />
              {o.label}
            </Link>
          );
        })}
        <button type="button" className="cl-onglet" aria-expanded={menuOuvert} aria-controls="cl-nav-zone" onClick={() => setMenuOuvert((x) => !x)}>
          <Icone nom="plus" taille={20} />
          Plus
        </button>
      </nav>
    </aside>
  );
}
