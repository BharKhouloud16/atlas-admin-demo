import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bleuFonce, fondClair } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";
import ClientNav from "@/components/client/ClientNav";

// LOT 1 — Client Workspace Foundation (15/09/2026) : "Espace Partenaire" ->
// "Espace Client" (vocabulaire visible uniquement — aucun nom technique
// touché : routes, session.role "CLIENT", modèle Prisma Client, etc.
// restent inchangés).
//
// LOT 7 (28/10/2026) — direction visuelle (planche validée) : navigation
// latérale sombre à gauche sur grand écran ; sur mobile (< 900 px) elle
// devient une barre supérieure avec un bouton « Menu » qui déplie la liste
// des rubriques. Mêmes rubriques, mêmes liens, même nom accessible
// (« Navigation Espace Client ») : aucun parcours existant n'est modifié.
// Les styles responsive sont regroupés ici (classes préfixées `cl-`) car les
// styles en ligne ne permettent pas de media queries.
const STYLES = `
.cl-shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; background: ${fondClair}; }
.cl-sidebar { background: ${bleuFonce}; color: #fff; position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; padding: 20px 14px; box-sizing: border-box; }
.cl-sidebar-tete { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cl-espace { display: block; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #aebbd8; margin: 6px 0 18px 38px; }
.cl-pied { margin-top: auto; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.12); font-size: 12px; color: #c9d3ea; display: flex; flex-direction: column; gap: 10px; overflow-wrap: anywhere; }
.cl-main { padding: 24px; min-width: 0; }
.cl-contenu { max-width: 1080px; margin: 0 auto; }
.cl-menu-bouton { display: none; }
.cl-nav a:focus-visible, .cl-menu-bouton:focus-visible, .cl-pied button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.cl-nav a:hover { background: rgba(255,255,255,.08); }
.cl-onglets { display: none; }
.cl-identite { display: flex; align-items: center; gap: 10px; }
.cl-avatar { width: 32px; height: 32px; border-radius: 999px; background: rgba(255,255,255,.15); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0; }
@media (max-width: 899px) {
  .cl-shell { grid-template-columns: minmax(0, 1fr); }
  .cl-sidebar { position: sticky; top: 0; z-index: 20; height: auto; padding: 10px 16px; }
  .cl-espace { display: none; }
  .cl-menu-bouton { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.35); border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .cl-nav-zone { display: none; }
  .cl-nav-zone[data-ouvert="oui"] { display: block; margin-top: 12px; }
  .cl-pied { margin-top: 12px; }
  .cl-main { padding: 16px 16px 88px; }
  .cl-onglets { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: #fff; border-top: 1px solid #e4e7ee; justify-content: space-around; padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); }
  .cl-onglet { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: #4b5567; text-decoration: none; background: none; border: 0; padding: 4px 8px; cursor: pointer; font-family: inherit; min-width: 56px; }
  .cl-onglet[aria-current="page"] { color: ${bleuFonce}; font-weight: 700; }
  .cl-onglet:focus-visible { outline: 2px solid ${bleuFonce}; outline-offset: 2px; }
}
`;

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT") {
    redirect("/connexion");
  }

  // LOT 7 (01/11/2026, planche) : identité de l'entreprise en pied de menu et
  // état de l'option ATLAS OS (pastille « Option » tant qu'elle n'est pas
  // activée). Une erreur ici n'empêche jamais l'affichage de l'espace.
  const entreprise = session.clientId
    ? await prisma.client
        .findUnique({ where: { id: session.clientId }, select: { nom: true, activationAtlasOs: { select: { statut: true } } } })
        .catch(() => null)
    : null;
  const initiales = (entreprise?.nom ?? session.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");

  return (
    <div className="cl-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <ClientNav
        logo={<LogoAtlas href="/client" couleurTexte="#fff" />}
        atlasOsActif={entreprise?.activationAtlasOs?.statut === "ACTIVEE"}
        pied={
          <>
            <span className="cl-identite">
              <span className="cl-avatar" aria-hidden="true">{initiales}</span>
              <span>
                <strong style={{ display: "block", color: "#fff" }}>{entreprise?.nom ?? "Espace Client"}</strong>
                <span>{session.email}</span>
              </span>
            </span>
            <BoutonDeconnexion style={{ alignSelf: "flex-start", borderRadius: 6 }} />
          </>
        }
      />
      <main className="cl-main">
        <div className="cl-contenu">{children}</div>
      </main>
    </div>
  );
}
