"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bleu, grisTexte } from "@/lib/theme";
import { UnreadBadge } from "@/components/client/primitives";

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
const RUBRIQUES: { href: string; label: string; disponible: boolean }[] = [
  { href: "/client", label: "Vue d'ensemble", disponible: true },
  { href: "/client/attentions", label: "Attention", disponible: true },
  { href: "/client/besoins", label: "Besoins", disponible: true },
  { href: "/client/talent", label: "Talents", disponible: true },
  { href: "/client/missions", label: "Missions", disponible: true },
  { href: "/client/atlas-os", label: "ATLAS OS / Services", disponible: false },
  { href: "/client/resultats", label: "Résultats", disponible: true },
  { href: "/client/documents", label: "Documents", disponible: true },
  { href: "/client/communication", label: "Communication", disponible: true },
  { href: "/client/finance", label: "Finance", disponible: true },
  // LOT 4 (15/09/2026) : "Entreprise" (réservée LOT 1, vide) devient
  // "Profil" — même emplacement de navigation, décision CEO explicite de
  // réutiliser cet emplacement plutôt qu'ajouter une 11e rubrique.
  { href: "/client/profil", label: "Profil", disponible: true },
];

export default function ClientNav() {
  const pathname = usePathname();
  const [nonLues, setNonLues] = useState(0);

  // Compteur non-lus chargé une fois à l'affichage de la navigation — même
  // discipline que le reste de l'Espace Client (aucun mécanisme de
  // rafraîchissement en temps réel n'existe ailleurs dans ce dépôt, jamais
  // introduit ici en premier).
  useEffect(() => {
    fetch("/api/client/attentions")
      .then((r) => r.json())
      .then((d) => setNonLues(d.nonLues ?? 0))
      .catch(() => {});
  }, [pathname]);

  return (
    <nav
      aria-label="Navigation Espace Client"
      style={{ display: "flex", flexWrap: "wrap", gap: 4, rowGap: 6 }}
    >
      {RUBRIQUES.map((r) => {
        const actif = r.href === "/client" ? pathname === "/client" : pathname?.startsWith(r.href);
        return (
          <Link
            key={r.href}
            href={r.href}
            aria-current={actif ? "page" : undefined}
            style={{
              fontSize: 13,
              fontWeight: actif ? 700 : 500,
              color: actif ? bleu : grisTexte,
              textDecoration: "none",
              padding: "6px 10px",
              borderRadius: 6,
              background: actif ? "#eaf0fd" : "transparent",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {r.label}
            {r.href === "/client/attentions" && <UnreadBadge count={nonLues} />}
            {!r.disponible && (
              <span style={{ fontSize: 9, fontWeight: 700, color: "#b7bfcc", textTransform: "uppercase" }}>bientôt</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
