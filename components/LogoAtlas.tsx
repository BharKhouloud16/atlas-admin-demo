import Link from "next/link";
import { bleu, bleuFonce } from "@/lib/theme";

// Reprend exactement la marque de la page d'accueil (voir app/page.tsx,
// header) — un badge bleu arrondi avec un check, suivi du nom complet —
// pour que le logo soit identique partout dans le site (accueil, connexion,
// inscription, espaces admin/ingénieur/client), plutôt que du texte brut.
export default function LogoAtlas({
  taille = 28,
  href = "/",
  compact = false,
}: {
  taille?: number;
  href?: string | null;
  compact?: boolean;
}) {
  const contenu = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: bleuFonce }}>
      <span
        style={{
          width: taille,
          height: taille,
          borderRadius: taille * 0.28,
          background: bleu,
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: taille * 0.5,
          flexShrink: 0,
        }}
      >
        ✓
      </span>
      {!compact && "Atlas Quality Partners"}
    </span>
  );

  if (!href) return contenu;

  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      {contenu}
    </Link>
  );
}
