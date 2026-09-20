import type { ReactNode, CSSProperties, ButtonHTMLAttributes, ReactElement } from "react";
import { bleu, bleuFonce, bordure, grisTexte, vert, orange, rouge, fondClair } from "@/lib/theme";
import type { AttentionCategorie, AttentionPriorite } from "@prisma/client";

// LOT 4 — Profil Client (15/09/2026) : deux ajouts minimaux au design
// system existant, aucun autre composant créé (Tabs et bouton tertiary —
// les seuls manquants identifiés par l'audit, voir rapport Phase 2 §24).

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

type BoutonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "tertiary" };

// Reprend exactement les deux styles de bouton déjà en usage (primaire bleu
// plein, secondaire contour gris) dans app/client/page.tsx et
// app/client/talent/page.tsx. `tertiary` (LOT 4) : action discrète, texte
// seul sans fond ni bordure — pour une action secondaire dans un header
// (ex. "Corriger mes informations") sans concurrencer visuellement l'action
// principale.
export function Bouton({ variant = "primary", style, ...props }: BoutonProps) {
  const base: CSSProperties =
    variant === "primary"
      ? { background: bleu, color: "#fff", border: "none" }
      : variant === "secondary"
        ? { background: "#fff", color: grisTexte, border: `1px solid ${bordure}` }
        : { background: "transparent", color: bleu, border: "none", padding: "7px 4px" };
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

// LOT 4 — Profil Client : onglets internes (première utilisation d'un
// composant Tabs dans l'Espace Client — aucun équivalent existant, voir
// audit design system). Scroll horizontal en dessous de la largeur
// nécessaire (mobile), jamais de retour à la ligne qui casserait la
// hiérarchie visuelle.
export function Tabs({
  tabs,
  actif,
  onChange,
}: {
  tabs: { id: string; label: string; badge?: number }[];
  actif: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sections du profil"
      style={{
        display: "flex",
        gap: 4,
        overflowX: "auto",
        borderBottom: `1px solid ${bordure}`,
        marginBottom: 20,
      }}
    >
      {tabs.map((t) => {
        const estActif = t.id === actif;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={estActif}
            onClick={() => onChange(t.id)}
            style={{
              fontSize: 13,
              fontWeight: estActif ? 700 : 500,
              color: estActif ? bleu : grisTexte,
              background: "none",
              border: "none",
              borderBottom: estActif ? `2px solid ${bleu}` : "2px solid transparent",
              padding: "8px 12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t.label}
            {typeof t.badge === "number" && t.badge > 0 && <Badge variant="warning">{t.badge}</Badge>}
          </button>
        );
      })}
    </div>
  );
}

// V2.2-B — Billing Foundation (17/09/2026) : premier besoin réel d'une
// forme tabulaire dans l'Espace Client (voir audit V2.2-A — jusqu'ici
// volontairement absente, tout étant des listes de cartes). `<table>`
// sémantique (accessibilité — lecteurs d'écran, navigation clavier) plutôt
// qu'une grille de `<div>` ; wrapper à défilement horizontal pour rester
// utilisable sur mobile sans reflow spécifique (voir mandat CEO V2.2-B
// section 19 : "réutilisable au-delà de Billing" — colonnes/lignes
// génériques, jamais un contenu Billing en dur).
export function Table({ colonnes, lignes, cleLigne }: { colonnes: { label: string; align?: "left" | "right" }[]; lignes: ReactNode[][]; cleLigne: (index: number) => string }) {
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${bordure}`, borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: fondClair }}>
            {colonnes.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: c.align ?? "left",
                  padding: "10px 12px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  color: grisTexte,
                  fontWeight: 700,
                  borderBottom: `1px solid ${bordure}`,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne, i) => (
            <tr key={cleLigne(i)} style={{ borderBottom: i < lignes.length - 1 ? `1px solid ${bordure}` : "none" }}>
              {ligne.map((cellule, j) => (
                <td key={j} style={{ padding: "10px 12px", textAlign: colonnes[j]?.align ?? "left", verticalAlign: "middle" }}>
                  {cellule}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Affiche un montant hiérarchisé (mandat CEO V2.2-B section 18 : "montant
// visible" comme critère UX de premier plan) — jamais une valeur brute
// sans contexte de devise, jamais un composant Billing-only (réutilisable
// pour tout montant de l'Espace Client).
export function MoneyDisplay({ montant, devise, taille = 20, couleur = bleuFonce }: { montant: number; devise: string; taille?: number; couleur?: string }): ReactElement {
  const formate = montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span style={{ fontSize: taille, fontWeight: 700, color: couleur }}>
      {formate} <span style={{ fontSize: taille * 0.55, fontWeight: 600 }}>{devise}</span>
    </span>
  );
}

// Bloc résumé (solde, prochaine échéance...) — reprend le style Card
// existant, jamais une nouvelle esthétique de "widget dashboard".
export function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card style={{ flex: "1 1 160px", minWidth: 160 }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, textTransform: "uppercase", color: "#888", fontWeight: 700 }}>{label}</p>
      {children}
    </Card>
  );
}

// V2.3 — Communication Intelligence + Attention Center (mandat CEO section
// 19 : "créer seulement les primitives nécessaires", noms repris de la
// liste donnée section 19). Seuls PriorityBadge/UnreadBadge/AttentionCard
// sont réellement utilisés dans ce lot (NotificationItem/AttentionFilters/
// AttentionSummary/ActionRequiredPanel n'ont aucun besoin réel identifié —
// jamais créés sans consommateur, même discipline que le reste de ce
// fichier).
const COULEUR_PRIORITE: Record<AttentionPriorite, BadgeVariant> = {
  P0_CRITIQUE: "error",
  P1_HAUTE: "warning",
  P2_NORMALE: "info",
  P3_BASSE: "neutral",
};

const LABEL_PRIORITE: Record<AttentionPriorite, string> = {
  P0_CRITIQUE: "Critique",
  P1_HAUTE: "Haute",
  P2_NORMALE: "Normale",
  P3_BASSE: "Basse",
};

const LABEL_CATEGORIE: Record<AttentionCategorie, string> = {
  ACTION_REQUISE: "Action requise",
  ALERTE: "Alerte",
  INFORMATION: "Information",
  RECOMMANDATION: "Recommandation",
};

// Priorité ET catégorie affichées ensemble (mandat section 4 : "Pourquoi
// est-ce important ? Dois-je agir ?") — jamais l'enum brute, toujours le
// libellé humain (même principe que LABEL_STATUT_FACTURE).
export function PriorityBadge({ priorite, categorie }: { priorite: AttentionPriorite; categorie: AttentionCategorie }) {
  return (
    <Badge variant={COULEUR_PRIORITE[priorite]}>
      {LABEL_CATEGORIE[categorie]} · {LABEL_PRIORITE[priorite]}
    </Badge>
  );
}

// Pastille de compteur non-lus — jamais affichée à zéro (mandat section 4 :
// "moins de notifications" — un badge à "0" est du bruit visuel, pas un
// signal).
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        background: rouge,
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export type AttentionCardData = {
  id: string;
  categorie: AttentionCategorie;
  priorite: AttentionPriorite;
  titre: string;
  resume: string;
  raison: string;
  statut: "OUVERTE" | "LUE" | "RESOLUE" | "EXPIREE";
  actionDisponible: { label: string; href: string } | null;
  createdAt: string;
};

// Carte d'Attention — parcours "je vois -> je comprends -> j'agir" (mandat
// section 20, UX Research) : priorité visible en premier, raison en second
// plan (progressive disclosure), action explicite en dernier. `onLire` est
// appelé au premier rendu visible d'une Attention OUVERTE par l'appelant
// (jamais ici — cette primitive reste sans effet de bord, voir
// app/client/attentions/page.tsx pour le déclenchement réel).
export function AttentionCard({ attention, onMarquerLu, onResoudre }: { attention: AttentionCardData; onMarquerLu?: () => void; onResoudre?: () => void }) {
  const peutResoudre = attention.categorie === "INFORMATION" || attention.categorie === "RECOMMANDATION";
  return (
    <Card
      style={{
        opacity: attention.statut === "RESOLUE" || attention.statut === "EXPIREE" ? 0.6 : 1,
        borderLeft: attention.statut === "OUVERTE" ? `3px solid ${COULEUR_PRIORITE[attention.priorite] === "error" ? rouge : COULEUR_PRIORITE[attention.priorite] === "warning" ? orange : bleu}` : `1px solid ${bordure}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <PriorityBadge priorite={attention.priorite} categorie={attention.categorie} />
        <span style={{ fontSize: 11, color: grisTexte, whiteSpace: "nowrap" }}>{new Date(attention.createdAt).toLocaleDateString("fr-FR")}</span>
      </div>
      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: "#111" }}>{attention.titre}</p>
      <p style={{ margin: "0 0 4px", fontSize: 13, color: grisTexte }}>{attention.resume}</p>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "#94a0b3" }}>{attention.raison}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {attention.actionDisponible && (
          <a href={attention.actionDisponible.href} style={{ textDecoration: "none" }}>
            <Bouton variant="primary">{attention.actionDisponible.label}</Bouton>
          </a>
        )}
        {attention.statut === "OUVERTE" && onMarquerLu && (
          <Bouton variant="secondary" onClick={onMarquerLu}>
            Marquer comme lu
          </Bouton>
        )}
        {peutResoudre && attention.statut !== "RESOLUE" && attention.statut !== "EXPIREE" && onResoudre && (
          <Bouton variant="tertiary" onClick={onResoudre}>
            Ignorer
          </Bouton>
        )}
      </div>
    </Card>
  );
}
