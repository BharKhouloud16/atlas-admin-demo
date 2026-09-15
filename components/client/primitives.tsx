import type { ReactNode, CSSProperties, ButtonHTMLAttributes } from "react";
import { bleu, bleuFonce, bordure, grisTexte, vert, orange, rouge } from "@/lib/theme";

// COMPANY ATLAS — LOT 1 : Client Workspace Foundation (15/09/2026).
//
// Primitives minimales pour l'Espace Client uniquement — pas un design
// system global (l'Admin et l'Ingénieur continuent leur style inline
// existant, jamais touché par ce lot). Justifiées par la multiplication des
// écrans du Workspace (10 rubriques) qui, sans primitives partagées,
// auraient copié-collé le même style inline dans chaque page — exactement
// ce qui se passait déjà avant ce lot (voir app/client/page.tsx,
// app/client/talent/page.tsx : mêmes bordures/rayons/couleurs répétés à la
// main). Reprend fidèlement le style déjà en usage (mêmes bordures fines,
// mêmes rayons, même palette lib/theme.ts) — aucune esthétique nouvelle,
// seulement une factorisation.
//
// Volontairement absentes : pas de Table (aucun écran du Workspace n'a une
// forme tabulaire — tout est déjà des listes de cartes, voir l'audit) ; pas
// de Modal/Dialog/Input/Select (aucun besoin réel identifié dans ce lot —
// les formulaires existants restent des <textarea>/<input> bruts, inchangés
// pour ne pas toucher à une logique qui fonctionne).

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        border: `1px solid ${bordure}`,
        borderRadius: 10,
        padding: 14,
        background: "#fff",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Bloc titré réutilisé pour chaque rubrique du dashboard/des pages — remplace
// le `<h1>Titre</h1>` répété tel quel dans chaque page existante. `action`
// est un élément optionnel aligné à droite du titre (ex. lien "Voir tout").
export function Section({
  title,
  action,
  children,
  style,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ marginBottom: 32, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: bleuFonce }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Remplace le `<p style={{color:"#888"}}>...</p>` répété tel quel dans
// chaque page existante pour un état "rien à afficher" — jamais de donnée
// inventée, seulement un message honnête.
export function EmptyState({ message }: { message: string }) {
  return <p style={{ color: "#94a0b3", fontSize: 13, margin: 0, padding: "8px 0" }}>{message}</p>;
}

// Réservée aux rubriques cibles (section 3 de l'ordre) sans contenu réel
// aujourd'hui — jamais de fausse donnée, jamais de fonctionnalité simulée.
export function BientotDisponible({ description }: { description: string }) {
  return (
    <Card style={{ textAlign: "center", padding: "40px 20px", background: "#fafbfd" }}>
      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: grisTexte, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Bientôt disponible
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#94a0b3", maxWidth: 420, marginInline: "auto" }}>{description}</p>
    </Card>
  );
}

export type BadgeVariant = "info" | "success" | "warning" | "error" | "neutral";

const COULEUR_VARIANT: Record<BadgeVariant, string> = {
  info: bleu,
  success: vert,
  warning: orange,
  error: rouge,
  neutral: grisTexte,
};

// Pastille de statut — reprend exactement le style déjà en usage (bordure +
// texte de la même couleur, rayon 999) dans app/client/talent/page.tsx et
// app/client/page.tsx, jamais une nouvelle esthétique.
export function Badge({ children, variant = "neutral" }: { children: ReactNode; variant?: BadgeVariant }) {
  const couleur = COULEUR_VARIANT[variant];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 9px",
        borderRadius: 999,
        border: `1px solid ${couleur}`,
        color: couleur,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

type BoutonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

// Reprend exactement les deux styles de bouton déjà en usage (primaire bleu
// plein, secondaire contour gris) dans app/client/page.tsx et
// app/client/talent/page.tsx.
export function Bouton({ variant = "primary", style, ...props }: BoutonProps) {
  const base: CSSProperties =
    variant === "primary"
      ? { background: bleu, color: "#fff", border: "none" }
      : { background: "#fff", color: grisTexte, border: `1px solid ${bordure}` };
  return (
    <button
      {...props}
      style={{
        fontSize: 13,
        fontWeight: 600,
        padding: "7px 14px",
        borderRadius: 6,
        cursor: props.disabled ? "default" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        ...base,
        ...style,
      }}
    />
  );
}
