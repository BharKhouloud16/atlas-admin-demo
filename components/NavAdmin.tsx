"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bleu, bleuFonce } from "@/lib/theme";

type Lien = { href: string; label: string };

// Nav latérale de l'espace admin — extraite en composant client pour
// pouvoir surligner le lien actif (usePathname), dans le même esprit que la
// nav à onglets de l'espace ingénieur (voir EspaceIngenieur.tsx).
export default function NavAdmin({ liens }: { liens: readonly Lien[] }) {
  const pathname = usePathname();

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {liens.map((l) => {
        const actif = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              style={{
                display: "block",
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: actif ? "#fff" : bleuFonce,
                background: actif ? bleu : "transparent",
                textDecoration: "none",
              }}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
