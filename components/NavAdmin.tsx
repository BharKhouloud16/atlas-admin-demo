"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bleu, bleuFonce } from "@/lib/theme";

type Lien = { href: string; label: string; compteur?: number };

// Nav latérale de l'espace admin — extraite en composant client pour
// pouvoir surligner le lien actif (usePathname), dans le même esprit que la
// nav à onglets de l'espace ingénieur (voir EspaceIngenieur.tsx).
export default function NavAdmin({ liens }: { liens: readonly Lien[] }) {
  const pathname = usePathname();

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {liens.map((l) => {
        // REV (01/11/2026) : correspondance par segment — « /admin/demandes »
        // ne s'active plus sur « /admin/demandes-clients ».
        const actif = l.href === "/admin" ? pathname === "/admin" : pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              style={{
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: actif ? "#fff" : bleuFonce,
                background: actif ? bleu : "transparent",
                textDecoration: "none",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 6,
              }}
            >
              {l.label}
              {/* REV (01/11/2026) : nombre de demandes à traiter, jamais affiché à zéro. */}
              {l.compteur ? (
                <span
                  aria-label={`${l.compteur} à traiter`}
                  style={{ background: actif ? "#fff" : bleu, color: actif ? bleu : "#fff", borderRadius: 999, fontSize: 11, padding: "1px 7px" }}
                >
                  {l.compteur > 99 ? "99+" : l.compteur}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
